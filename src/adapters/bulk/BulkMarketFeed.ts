import type { Candle as BulkCandle } from "bulk-ts-sdk";

import type {
  IMarketFeed,
  MarketSnapshot,
  SnapshotListener,
} from "../../domain/ports/IMarketFeed.ts";
import { logger } from "../../utils/logger.ts";

type BulkLevel = { price?: number; px?: number; size?: number; sz?: number };
type BulkBook = { levels?: BulkLevel[][]; timestamp?: number };
type BulkTicker = {
  markPrice?: number;
  lastPrice?: number;
  fairBookPx?: number;
  timestamp?: number;
};
type BulkAccount = { margin?: { totalBalance?: number; marginUsed?: number } };
type BulkSubscriptionHandle = { unsubscribe(): Promise<void> };

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
}

const DEFAULT_CANDLE_INTERVAL = "1m";
const MAX_CANDLES_PER_MESSAGE = 20;

function nsToMs(timestamp: number | undefined): number {
  if (timestamp === undefined) {
    return Date.now();
  }
  return timestamp > 9_999_999_999_999 ? Math.floor(timestamp / 1_000_000) : timestamp;
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
    markPrice: snapshot.markPrice,
    timestamp: snapshot.timestamp,
    marginRatio: snapshot.marginRatio,
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
  private lastCandleTs: number | null = null;
  private snapshot: MarketSnapshot | null = null;

  constructor(
    private readonly client: BulkMarketFeedClient,
    private readonly params: BulkMarketFeedParams,
  ) {}

  async connect(): Promise<void> {
    logger.info(
      `bulk_market_feed.connect market=${this.params.market} nlevels=${this.params.nlevels ?? "default"}`,
    );
    await this.refreshSnapshot();
    await this.subscribeWs();
    logger.info(`bulk_market_feed.connected market=${this.params.market}`);
  }

  async disconnect(): Promise<void> {
    logger.info(`bulk_market_feed.disconnect market=${this.params.market}`);
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
    const [ticker, book, marginRatio] = await Promise.all([
      this.client.market.ticker(this.params.market),
      this.client.market.l2Book({ symbol: this.params.market, nlevels: this.params.nlevels }),
      this.fetchMarginRatio(),
    ]);
    this.snapshot = this.snapshotFrom(ticker, book, marginRatio);
    logger.info(
      `bulk_market_feed.snapshot_seeded market=${this.snapshot.market} bestBid=${this.snapshot.bestBid} bestAsk=${this.snapshot.bestAsk} markPrice=${this.snapshot.markPrice} marginRatio=${this.snapshot.marginRatio}`,
    );
    this.publish(this.snapshot);
  }

  private async subscribeWs(): Promise<void> {
    const ticker = await this.client.ws.subscribe(
      { type: "ticker", symbol: this.params.market },
      (message: unknown) => this.mergeTicker(message),
    );
    const book = await this.client.ws.subscribe(
      { type: "l2Snapshot", symbol: this.params.market, nlevels: this.params.nlevels },
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
      `bulk_market_feed.ws_subscribed market=${this.params.market} topics=ticker,l2Snapshot,candle`,
    );
  }

  private snapshotFrom(
    ticker: BulkTicker,
    book: BulkBook,
    marginRatio: number | null,
  ): MarketSnapshot {
    const [bidLevel, askLevel] = this.topLevels(book);
    const bestBid = levelPrice(bidLevel);
    const bestAsk = levelPrice(askLevel);
    if (bestBid === undefined || bestAsk === undefined) {
      throw new Error(`No Bulk order book levels for ${this.params.market}`);
    }
    return {
      market: this.params.market,
      bestBid,
      bestAsk,
      microPrice: microPrice(bestBid, bestAsk, levelSize(bidLevel), levelSize(askLevel)),
      markPrice:
        ticker.markPrice ?? ticker.fairBookPx ?? ticker.lastPrice ?? (bestBid + bestAsk) / 2,
      timestamp: nsToMs(book.timestamp ?? ticker.timestamp),
      marginRatio,
    };
  }

  private mergeTicker(message: unknown): void {
    if (this.snapshot === null) {
      return;
    }
    const data = payloadOf(message, ["ticker"]);
    const markPrice = Number(data.markPrice ?? data.fairBookPx ?? data.lastPrice);
    if (!Number.isFinite(markPrice)) {
      return;
    }
    this.snapshot = {
      ...quoteSnapshot(this.snapshot),
      markPrice,
      timestamp: nsToMs(typeof data.timestamp === "number" ? data.timestamp : undefined),
    };
    logger.debug(
      `bulk_market_feed.ticker_updated market=${this.snapshot.market} markPrice=${this.snapshot.markPrice} timestamp=${this.snapshot.timestamp}`,
    );
    this.publish(this.snapshot);
  }

  private mergeBook(message: unknown): void {
    if (this.snapshot === null) {
      return;
    }
    const data = payloadOf(message, ["l2Snapshot", "l2snapshot", "book"]) as BulkBook;
    const levels = this.tryTopLevels(data);
    if (levels === null) {
      return;
    }
    const [bidLevel, askLevel] = levels;
    const bestBid = levelPrice(bidLevel);
    const bestAsk = levelPrice(askLevel);
    if (bestBid === undefined || bestAsk === undefined) {
      return;
    }
    this.snapshot = {
      ...quoteSnapshot(this.snapshot),
      bestBid,
      bestAsk,
      microPrice: microPrice(bestBid, bestAsk, levelSize(bidLevel), levelSize(askLevel)),
      timestamp: nsToMs(data.timestamp),
    };
    logger.debug(
      `bulk_market_feed.book_updated market=${this.snapshot.market} bestBid=${this.snapshot.bestBid} bestAsk=${this.snapshot.bestAsk} microPrice=${this.snapshot.microPrice} timestamp=${this.snapshot.timestamp}`,
    );
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

  private topLevels(book: BulkBook): [BulkLevel, BulkLevel] {
    const levels = this.tryTopLevels(book);
    if (levels === null) {
      throw new Error(`No Bulk order book levels for ${this.params.market}`);
    }
    return levels;
  }

  private tryTopLevels(book: BulkBook): [BulkLevel, BulkLevel] | null {
    const bid = book.levels?.[0]?.[0];
    const ask = book.levels?.[1]?.[0];
    if (!bid || !ask) {
      return null;
    }
    return [bid, ask];
  }

  private async fetchMarginRatio(): Promise<number | null> {
    if (!this.params.accountId) {
      return null;
    }
    const account = await this.client.account.fullAccount(this.params.accountId);
    const totalBalance = account.margin?.totalBalance;
    const marginUsed = account.margin?.marginUsed;
    if (totalBalance === undefined || totalBalance <= 0 || marginUsed === undefined) {
      throw new Error(`No Bulk margin data for ${this.params.accountId}`);
    }
    return Math.max(0, (totalBalance - marginUsed) / totalBalance);
  }

  private publish(snapshot: MarketSnapshot): void {
    for (const listener of this.listeners) {
      void listener(snapshot);
    }
  }
}
