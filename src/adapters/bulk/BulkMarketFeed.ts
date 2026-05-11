import type { Candle as BulkCandle } from "bulk-ts-sdk";

import type {
  IMarketFeed,
  MarketSnapshot,
  OrderBookLevel,
  SnapshotListener,
} from "../../domain/ports/IMarketFeed.ts";
import { calculateDepthVampPrice } from "../../domain/FairPriceCalculator.ts";
import { logger } from "../../utils/logger.ts";
import { retryTransientBulk } from "../../utils/transientBulk.ts";

type BulkLevel = { price?: number; px?: number; size?: number; sz?: number };
type BulkBook = { updateType?: "snapshot" | "delta"; levels?: BulkLevel[][]; timestamp?: number };
type BulkTicker = {
  markPrice?: number;
  lastPrice?: number;
  fairBookPx?: number;
  timestamp?: number;
};
type BulkPositionEntry = {
  symbol?: string;
  size?: number;
  iso?: boolean;
};
type BulkAccount = {
  margin?: { totalBalance?: number; marginUsed?: number };
  positions?: BulkPositionEntry[];
};
interface BulkMarginState {
  marginRatio: number | null;
  availableMarginUsd: number | null;
  accountUpdatedAt: number | null;
  positionQty: number | null;
  positionUpdatedAt: number | null;
}
type BulkSubscriptionHandle = { unsubscribe(): Promise<void> };
type MarketWsStaleReason = "book_ws_stale" | "ticker_ws_stale";

interface BulkMarketClient {
  ticker(symbol: string): Promise<BulkTicker>;
  l2Book(params: { symbol: string; nlevels?: number }): Promise<BulkBook>;
}

interface BulkAccountClient {
  fullAccount(user: string): Promise<BulkAccount>;
}

interface BulkWsClient {
  subscribe(
    subscription: unknown,
    handler: (message: unknown) => void,
  ): Promise<BulkSubscriptionHandle>;
  close(): Promise<void>;
}

interface BulkMarketFeedClient {
  market: BulkMarketClient;
  account: BulkAccountClient;
  ws: BulkWsClient;
}

interface BulkMarketFeedParams {
  market: string;
  nlevels?: number;
  accountId?: string;
  candleInterval?: "1m";
  accountRetryAttempts?: number;
  accountRetryDelayMs?: number;
  marketWsReconnectAfterMs?: number;
  accountPollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CANDLE_INTERVAL = "1m";
const DEFAULT_ACCOUNT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MARKET_WS_WATCHDOG_INTERVAL_MS = 250;
const DEFAULT_MARKET_WS_RECONNECT_AFTER_MS = 5_000;
const MAX_CANDLES_PER_MESSAGE = 20;

function nsToMs(timestamp: number | undefined): number {
  if (timestamp === undefined) {
    return Date.now();
  }
  return timestamp > 9_999_999_999_999 ? Math.floor(timestamp / 1_000_000) : timestamp;
}

function ageMs(timestamp: number | undefined, nowMs = Date.now()): number {
  return timestamp === undefined ? 0 : Math.max(0, nowMs - timestamp);
}

function levelPrice(level: BulkLevel): number | undefined {
  return level.price ?? level.px;
}

function levelSize(level: BulkLevel): number {
  return level.size ?? level.sz ?? 0;
}

function microPrice(bestBid: number, bestAsk: number, bidSize: number, askSize: number): number {
  const denominator = bidSize + askSize;
  if (denominator === 0) {
    return (bestBid + bestAsk) / 2;
  }
  return (bestAsk * bidSize + bestBid * askSize) / denominator;
}

function quoteSnapshot(snapshot: MarketSnapshot): MarketSnapshot {
  return {
    market: snapshot.market,
    bestBid: snapshot.bestBid,
    bestAsk: snapshot.bestAsk,
    microPrice: snapshot.microPrice,
    vampPrice: snapshot.vampPrice,
    orderBookLevels: snapshot.orderBookLevels,
    markPrice: snapshot.markPrice,
    timestamp: snapshot.timestamp,
    bookUpdatedAt: snapshot.bookUpdatedAt,
    tickerUpdatedAt: snapshot.tickerUpdatedAt,
    bookReceivedAt: snapshot.bookReceivedAt,
    tickerReceivedAt: snapshot.tickerReceivedAt,
    bookExchangeTimestamp: snapshot.bookExchangeTimestamp,
    tickerExchangeTimestamp: snapshot.tickerExchangeTimestamp,
    candleUpdatedAt: snapshot.candleUpdatedAt,
    accountUpdatedAt: snapshot.accountUpdatedAt,
    positionUpdatedAt: snapshot.positionUpdatedAt,
    positionQty: snapshot.positionQty,
    marginRatio: snapshot.marginRatio,
    availableMarginUsd: snapshot.availableMarginUsd,
  };
}

function dataOf(message: unknown): Record<string, unknown> {
  if (typeof message !== "object" || message === null) {
    return {};
  }
  const record = message as Record<string, unknown>;
  const data = record.data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : record;
}

function payloadOf(message: unknown, nestedKeys: string[]): Record<string, unknown> {
  const data = dataOf(message);
  for (const key of nestedKeys) {
    const nested = data[key];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return data;
}

function crossPositionQty(positions: BulkPositionEntry[] | undefined, market: string): number {
  return positions?.find((entry) => entry.symbol === market && entry.iso !== true)?.size ?? 0;
}

function candlesOf(message: unknown): BulkCandle[] {
  const data = dataOf(message);
  const candles = data.candles;
  if (Array.isArray(candles)) {
    return candles as BulkCandle[];
  }
  return [];
}

export class BulkMarketFeed implements IMarketFeed {
  private readonly listeners = new Set<SnapshotListener>();
  private readonly unsubscribers: Array<() => Promise<void>> = [];
  private readonly bidLevels = new Map<number, number>();
  private readonly askLevels = new Map<number, number>();
  private lastCandleTs: number | null = null;
  private snapshot: MarketSnapshot | null = null;
  private accountPollTimer: ReturnType<typeof setInterval> | null = null;
  private marketWsWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private accountPollInFlight = false;
  private marketResyncInFlight = false;
  private wsReconnectInFlight = false;
  private wsSubscribedAtMs: number | null = null;
  private lastWsBookReceivedAtMs: number | null = null;
  private lastWsTickerReceivedAtMs: number | null = null;
  private connected = false;

  constructor(
    private readonly client: BulkMarketFeedClient,
    private readonly params: BulkMarketFeedParams,
  ) {}

  private isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    logger.info(
      `bulk_market_feed.connect market=${this.params.market} nlevels=${this.params.nlevels ?? "default"}`,
    );
    this.connected = true;
    try {
      await this.refreshSnapshot();
      await this.subscribeWs();
      this.startAccountPolling();
      this.startMarketWsWatchdog();
      logger.info(`bulk_market_feed.connected market=${this.params.market}`);
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    logger.info(`bulk_market_feed.disconnect market=${this.params.market}`);
    this.connected = false;
    this.stopAccountPolling();
    this.stopMarketWsWatchdog();
    const results = await Promise.allSettled(
      this.unsubscribers.splice(0).map(async (unsubscribe) => unsubscribe()),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(`BulkMarketFeed.disconnect unsubscribe failed: ${String(result.reason)}`);
      }
    }
    await this.client.ws.close();
    logger.info(`bulk_market_feed.disconnected market=${this.params.market}`);
  }

  async getSnapshot(): Promise<MarketSnapshot> {
    if (this.snapshot === null) {
      await this.refreshSnapshot();
    }
    if (this.snapshot === null) {
      throw new Error("BulkMarketFeed snapshot is unavailable");
    }
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async refreshSnapshot(): Promise<void> {
    const [ticker, book, marginState] = await Promise.all([
      this.client.market.ticker(this.params.market),
      this.client.market.l2Book({ symbol: this.params.market, nlevels: this.params.nlevels }),
      this.fetchMarginState(),
    ]);
    this.snapshot = this.snapshotFrom(ticker, book, marginState);
    logger.info(
      `bulk_market_feed.snapshot_seeded market=${this.snapshot.market} bestBid=${this.snapshot.bestBid} bestAsk=${this.snapshot.bestAsk} markPrice=${this.snapshot.markPrice} marginRatio=${this.snapshot.marginRatio} availableMarginUsd=${this.snapshot.availableMarginUsd ?? "null"}`,
    );
    this.publish(this.snapshot);
  }

  private async resyncMarketState(reason: string): Promise<void> {
    const currentSnapshot = this.snapshot;
    if (!this.isConnected() || currentSnapshot === null) {
      return;
    }
    const [ticker, book] = await Promise.all([
      this.client.market.ticker(this.params.market),
      this.client.market.l2Book({ symbol: this.params.market, nlevels: this.params.nlevels }),
    ]);
    if (!this.isConnected()) {
      return;
    }
    const seeded = this.snapshotFrom(ticker, book, {
      marginRatio: currentSnapshot.marginRatio,
      availableMarginUsd: currentSnapshot.availableMarginUsd ?? null,
      accountUpdatedAt: currentSnapshot.accountUpdatedAt ?? null,
      positionQty: currentSnapshot.positionQty ?? null,
      positionUpdatedAt: currentSnapshot.positionUpdatedAt ?? null,
    });
    this.snapshot = seeded;
    logger.info(
      `bulk_market_feed.market_resynced market=${this.snapshot.market} reason=${reason} bestBid=${this.snapshot.bestBid} bestAsk=${this.snapshot.bestAsk} bookUpdatedAt=${this.snapshot.bookUpdatedAt ?? "null"} tickerUpdatedAt=${this.snapshot.tickerUpdatedAt ?? "null"}`,
    );
    this.publish(this.snapshot);
  }

  private async subscribeWs(): Promise<void> {
    if (!this.isConnected()) {
      return;
    }
    this.wsSubscribedAtMs = Date.now();
    this.lastWsBookReceivedAtMs = null;
    this.lastWsTickerReceivedAtMs = null;
    const ticker = await this.client.ws.subscribe(
      { type: "ticker", symbol: this.params.market },
      (message: unknown) => this.mergeTicker(message),
    );
    const book = await this.client.ws.subscribe(
      { type: "l2Delta", symbol: this.params.market },
      (message: unknown) => this.mergeBook(message),
    );
    const candle = await this.client.ws.subscribe(
      {
        type: "candle",
        symbol: this.params.market,
        interval: this.params.candleInterval ?? DEFAULT_CANDLE_INTERVAL,
      },
      (message: unknown) => this.mergeCandle(message),
    );
    this.unsubscribers.push(
      async () => ticker.unsubscribe(),
      async () => book.unsubscribe(),
      async () => candle.unsubscribe(),
    );
    logger.info(
      `bulk_market_feed.ws_subscribed market=${this.params.market} topics=ticker,l2Delta,candle`,
    );
  }

  private async reconnectWs(reason: string): Promise<void> {
    if (!this.isConnected() || this.wsReconnectInFlight) {
      return;
    }
    this.wsReconnectInFlight = true;
    const startedAt = Date.now();
    try {
      logger.warn(
        `bulk_market_feed.ws_reconnect_started market=${this.params.market} reason=${reason}`,
      );
      const results = await Promise.allSettled(
        this.unsubscribers.splice(0).map(async (unsubscribe) => unsubscribe()),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          logger.warn(`BulkMarketFeed.reconnect unsubscribe failed: ${String(result.reason)}`);
        }
      }
      await this.client.ws.close();
      if (!this.isConnected()) {
        return;
      }
      await this.subscribeWs();
      logger.warn(
        `bulk_market_feed.ws_reconnect_complete market=${this.params.market} reason=${reason} latencyMs=${Date.now() - startedAt}`,
      );
    } finally {
      this.wsReconnectInFlight = false;
    }
  }

  private snapshotFrom(
    ticker: BulkTicker,
    book: BulkBook,
    marginState: BulkMarginState,
  ): MarketSnapshot {
    this.replaceLocalBook(book);
    const bookLevels = this.bookLevelsFromLocalBook();
    const topLevel = bookLevels[0];
    if (topLevel === undefined) {
      throw new Error(`No Bulk order book levels for ${this.params.market}`);
    }
    const bestBid = topLevel.bidPrice;
    const bestAsk = topLevel.askPrice;
    const receivedAt = Date.now();
    const bookExchangeTimestamp =
      typeof book.timestamp === "number" ? nsToMs(book.timestamp) : undefined;
    const tickerExchangeTimestamp =
      typeof ticker.timestamp === "number" ? nsToMs(ticker.timestamp) : undefined;
    return {
      market: this.params.market,
      bestBid,
      bestAsk,
      microPrice: microPrice(bestBid, bestAsk, topLevel.bidSize, topLevel.askSize),
      vampPrice: calculateDepthVampPrice(bookLevels),
      orderBookLevels: bookLevels,
      markPrice:
        ticker.markPrice ?? ticker.fairBookPx ?? ticker.lastPrice ?? (bestBid + bestAsk) / 2,
      timestamp: receivedAt,
      bookUpdatedAt: receivedAt,
      tickerUpdatedAt: receivedAt,
      bookReceivedAt: receivedAt,
      tickerReceivedAt: receivedAt,
      bookExchangeTimestamp,
      tickerExchangeTimestamp,
      candleUpdatedAt: null,
      accountUpdatedAt: marginState.accountUpdatedAt,
      positionUpdatedAt: marginState.positionUpdatedAt,
      positionQty: marginState.positionQty,
      marginRatio: marginState.marginRatio,
      availableMarginUsd: marginState.availableMarginUsd,
    };
  }

  private mergeTicker(message: unknown): void {
    if (this.snapshot === null) {
      return;
    }
    const receivedAt = Date.now();
    const previousMarkPrice = this.snapshot.markPrice;
    this.lastWsTickerReceivedAtMs = receivedAt;
    const data = payloadOf(message, ["ticker"]);
    const markPrice = Number(data.markPrice ?? data.fairBookPx ?? data.lastPrice);
    if (!Number.isFinite(markPrice)) {
      return;
    }
    const exchangeTimestamp =
      typeof data.timestamp === "number" ? nsToMs(data.timestamp) : undefined;
    this.snapshot = {
      ...quoteSnapshot(this.snapshot),
      markPrice,
      timestamp: receivedAt,
      tickerUpdatedAt: receivedAt,
      tickerReceivedAt: receivedAt,
      tickerExchangeTimestamp: exchangeTimestamp,
    };
    if (previousMarkPrice !== markPrice) {
      logger.debug(
        `bulk_market_feed.ticker_updated market=${this.snapshot.market} markPrice=${this.snapshot.markPrice} timestamp=${this.snapshot.timestamp}`,
      );
    }
    this.publish(this.snapshot);
  }

  private mergeBook(message: unknown): void {
    if (this.snapshot === null) {
      return;
    }
    const receivedAt = Date.now();
    const previousBestBid = this.snapshot.bestBid;
    const previousBestAsk = this.snapshot.bestAsk;
    this.lastWsBookReceivedAtMs = receivedAt;
    const data = payloadOf(message, ["l2Delta", "l2delta", "book"]) as BulkBook;
    if (!this.applyBookDelta(data)) {
      return;
    }
    const bookLevels = this.bookLevelsFromLocalBook();
    const topLevel = bookLevels[0];
    if (topLevel === undefined) {
      this.resyncMarketStateOnce("book_empty");
      return;
    }
    const bestBid = topLevel.bidPrice;
    const bestAsk = topLevel.askPrice;
    if (bestBid >= bestAsk) {
      this.resyncMarketStateOnce("book_crossed");
      return;
    }
    const exchangeTimestamp =
      typeof data.timestamp === "number" ? nsToMs(data.timestamp) : undefined;
    this.snapshot = {
      ...quoteSnapshot(this.snapshot),
      bestBid,
      bestAsk,
      microPrice: microPrice(bestBid, bestAsk, topLevel.bidSize, topLevel.askSize),
      vampPrice: calculateDepthVampPrice(bookLevels),
      orderBookLevels: bookLevels,
      timestamp: receivedAt,
      bookUpdatedAt: receivedAt,
      bookReceivedAt: receivedAt,
      bookExchangeTimestamp: exchangeTimestamp,
    };
    if (previousBestBid !== bestBid || previousBestAsk !== bestAsk) {
      logger.debug(
        `bulk_market_feed.book_updated market=${this.snapshot.market} bestBid=${this.snapshot.bestBid} bestAsk=${this.snapshot.bestAsk} microPrice=${this.snapshot.microPrice} timestamp=${this.snapshot.timestamp}`,
      );
    }
    this.publish(this.snapshot);
  }

  private mergeCandle(message: unknown): void {
    if (this.snapshot === null) {
      return;
    }
    const candles = candlesOf(message).slice(-MAX_CANDLES_PER_MESSAGE);
    for (const candle of candles) {
      this.applyCandle(candle);
    }
  }

  private applyCandle(data: BulkCandle): void {
    if (this.snapshot === null) {
      return;
    }
    const timestamp = typeof data.t === "number" ? data.t : undefined;
    const open = Number(data.o);
    const high = Number(data.h);
    const low = Number(data.l);
    const close = Number(data.c);
    const volume = Number(data.v);
    if (
      timestamp === undefined ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      return;
    }
    const ts = nsToMs(timestamp);
    if (this.lastCandleTs !== null && ts < this.lastCandleTs) {
      return;
    }
    this.lastCandleTs = ts;

    this.snapshot = {
      ...this.snapshot,
      markPrice: close,
      timestamp: ts,
      candleUpdatedAt: ts,
      open,
      high,
      low,
      close,
      volume,
    };
    logger.info(
      `bulk_market_feed.candle_received market=${this.snapshot.market} ts=${this.snapshot.timestamp} open=${open} high=${high} low=${low} close=${close} volume=${volume}`,
    );
    this.publish(this.snapshot);
  }

  private startAccountPolling(): void {
    if (!this.params.accountId || this.accountPollTimer !== null) {
      return;
    }
    const intervalMs = this.params.accountPollIntervalMs ?? DEFAULT_ACCOUNT_POLL_INTERVAL_MS;
    this.accountPollTimer = setInterval(() => {
      if (this.accountPollInFlight) {
        return;
      }
      this.accountPollInFlight = true;
      void this.refreshAccountState()
        .catch((error) => {
          logger.warn(
            `bulk_market_feed.account_poll_failed market=${this.params.market} error=${String(error)}`,
          );
        })
        .finally(() => {
          this.accountPollInFlight = false;
        });
    }, intervalMs);
    this.accountPollTimer.unref();
    logger.info(
      `bulk_market_feed.account_polling_started market=${this.params.market} intervalMs=${intervalMs}`,
    );
  }

  private stopAccountPolling(): void {
    if (this.accountPollTimer === null) {
      return;
    }
    clearInterval(this.accountPollTimer);
    this.accountPollTimer = null;
  }

  private startMarketWsWatchdog(): void {
    if (this.marketWsWatchdogTimer !== null) {
      return;
    }
    const intervalMs = DEFAULT_MARKET_WS_WATCHDOG_INTERVAL_MS;
    this.marketWsWatchdogTimer = setInterval(() => {
      if (this.snapshot === null || this.wsReconnectInFlight) {
        return;
      }
      const staleReason = this.marketWsStaleReason(Date.now());
      if (staleReason === null) {
        return;
      }
      logger.info(
        `bulk_market_feed.market_ws_stale_detected market=${this.params.market} reason=${staleReason} bookWsAgeMs=${ageMs(this.lastWsBookReceivedAtMs ?? this.wsSubscribedAtMs ?? undefined)} tickerWsAgeMs=${ageMs(this.lastWsTickerReceivedAtMs ?? this.wsSubscribedAtMs ?? undefined)}`,
      );
      void this.reconnectWs(staleReason).catch((error) => {
        logger.warn(
          `bulk_market_feed.ws_reconnect_failed market=${this.params.market} reason=${staleReason} error=${String(error)}`,
        );
      });
    }, intervalMs);
    this.marketWsWatchdogTimer.unref();
    logger.info(
      `bulk_market_feed.market_ws_watchdog_started market=${this.params.market} intervalMs=${intervalMs} reconnectAfterMs=${this.marketWsReconnectAfterMs()}`,
    );
  }

  private stopMarketWsWatchdog(): void {
    if (this.marketWsWatchdogTimer === null) {
      return;
    }
    clearInterval(this.marketWsWatchdogTimer);
    this.marketWsWatchdogTimer = null;
  }

  private marketWsReconnectAfterMs(): number {
    return this.params.marketWsReconnectAfterMs ?? DEFAULT_MARKET_WS_RECONNECT_AFTER_MS;
  }

  private marketWsStaleReason(nowMs: number): MarketWsStaleReason | null {
    const subscribedAt = this.wsSubscribedAtMs;
    if (subscribedAt === null) {
      return null;
    }
    const staleAfterMs = this.marketWsReconnectAfterMs();
    const lastBookMessageAt = this.lastWsBookReceivedAtMs ?? subscribedAt;
    if (nowMs - lastBookMessageAt > staleAfterMs) {
      return "book_ws_stale";
    }
    if (
      this.lastWsBookReceivedAtMs !== null &&
      this.snapshot?.bookExchangeTimestamp !== undefined &&
      nowMs - this.snapshot.bookExchangeTimestamp > staleAfterMs
    ) {
      return "book_ws_stale";
    }
    const lastTickerMessageAt = this.lastWsTickerReceivedAtMs ?? subscribedAt;
    if (nowMs - lastTickerMessageAt > staleAfterMs) {
      return "ticker_ws_stale";
    }
    if (
      this.lastWsTickerReceivedAtMs !== null &&
      this.snapshot?.tickerExchangeTimestamp !== undefined &&
      nowMs - this.snapshot.tickerExchangeTimestamp > staleAfterMs
    ) {
      return "ticker_ws_stale";
    }
    return null;
  }

  private async refreshAccountState(): Promise<void> {
    if (this.snapshot === null) {
      return;
    }
    const marginState = await this.fetchMarginState({ attempts: 1 });
    this.snapshot = {
      ...this.snapshot,
      accountUpdatedAt: marginState.accountUpdatedAt,
      positionUpdatedAt: marginState.positionUpdatedAt,
      positionQty: marginState.positionQty,
      marginRatio: marginState.marginRatio,
      availableMarginUsd: marginState.availableMarginUsd,
    };
    logger.debug(
      `bulk_market_feed.account_updated market=${this.snapshot.market} marginRatio=${this.snapshot.marginRatio} availableMarginUsd=${this.snapshot.availableMarginUsd ?? "null"} positionQty=${this.snapshot.positionQty ?? "null"} accountUpdatedAt=${this.snapshot.accountUpdatedAt ?? "null"}`,
    );
    this.publish(this.snapshot);
  }

  private replaceLocalBook(book: BulkBook): void {
    this.bidLevels.clear();
    this.askLevels.clear();
    this.replaceSide(this.bidLevels, book.levels?.[0] ?? []);
    this.replaceSide(this.askLevels, book.levels?.[1] ?? []);
  }

  private replaceSide(side: Map<number, number>, levels: BulkLevel[]): void {
    for (const level of levels) {
      const price = levelPrice(level);
      const size = levelSize(level);
      if (
        price === undefined ||
        !Number.isFinite(price) ||
        !Number.isFinite(size) ||
        price <= 0 ||
        size <= 0
      ) {
        continue;
      }
      side.set(price, size);
    }
  }

  private applyBookDelta(book: BulkBook): boolean {
    const bidUpdates = book.levels?.[0] ?? [];
    const askUpdates = book.levels?.[1] ?? [];
    let changed = false;
    changed = this.applySideDelta(this.bidLevels, bidUpdates) || changed;
    changed = this.applySideDelta(this.askLevels, askUpdates) || changed;
    return changed;
  }

  private applySideDelta(side: Map<number, number>, levels: BulkLevel[]): boolean {
    let changed = false;
    for (const level of levels) {
      const price = levelPrice(level);
      const size = levelSize(level);
      if (price === undefined || !Number.isFinite(price) || !Number.isFinite(size) || price <= 0) {
        continue;
      }
      if (size <= 0) {
        changed = side.delete(price) || changed;
        continue;
      }
      side.set(price, size);
      changed = true;
    }
    return changed;
  }

  private bookLevelsFromLocalBook(): OrderBookLevel[] {
    const bids = [...this.bidLevels.entries()]
      .sort(([left], [right]) => right - left)
      .slice(0, this.params.nlevels);
    const asks = [...this.askLevels.entries()]
      .sort(([left], [right]) => left - right)
      .slice(0, this.params.nlevels);
    const length = Math.min(bids.length, asks.length);
    const levels: OrderBookLevel[] = [];
    for (let index = 0; index < length; index += 1) {
      const bid = bids[index];
      const ask = asks[index];
      if (bid === undefined || ask === undefined) {
        continue;
      }
      const [bidPrice, bidSize] = bid;
      const [askPrice, askSize] = ask;
      levels.push({ bidPrice, bidSize, askPrice, askSize });
    }
    return levels;
  }

  private resyncMarketStateOnce(reason: string): void {
    if (this.marketResyncInFlight) {
      return;
    }
    this.marketResyncInFlight = true;
    void this.resyncMarketState(reason)
      .catch((error) => {
        logger.warn(
          `bulk_market_feed.market_resync_failed market=${this.params.market} reason=${reason} error=${String(error)}`,
        );
      })
      .finally(() => {
        this.marketResyncInFlight = false;
      });
  }

  private async fetchMarginState(options: { attempts?: number } = {}): Promise<BulkMarginState> {
    if (!this.params.accountId) {
      return {
        marginRatio: null,
        availableMarginUsd: null,
        accountUpdatedAt: null,
        positionQty: null,
        positionUpdatedAt: null,
      };
    }
    const account = await retryTransientBulk(
      async () => this.client.account.fullAccount(this.params.accountId ?? ""),
      {
        attempts: options.attempts ?? this.params.accountRetryAttempts ?? 1,
        delayMs: this.params.accountRetryDelayMs ?? 1_000,
        sleep: this.params.sleep,
        onRetry: (error, attempt, attempts) => {
          logger.warn(
            `bulk_market_feed.margin_transient_retry market=${this.params.market} attempt=${attempt}/${attempts} error=${String(error)}`,
          );
        },
      },
    );
    const totalBalance = account.margin?.totalBalance;
    const marginUsed = account.margin?.marginUsed;
    if (totalBalance === undefined || totalBalance <= 0 || marginUsed === undefined) {
      throw new Error(`No Bulk margin data for ${this.params.accountId}`);
    }
    const observedAt = Date.now();
    const availableMarginUsd = Math.max(0, totalBalance - marginUsed);
    return {
      marginRatio: availableMarginUsd / totalBalance,
      availableMarginUsd,
      accountUpdatedAt: observedAt,
      positionQty: crossPositionQty(account.positions, this.params.market),
      positionUpdatedAt: observedAt,
    };
  }

  private publish(snapshot: MarketSnapshot): void {
    for (const listener of this.listeners) {
      void listener(snapshot);
    }
  }
}
