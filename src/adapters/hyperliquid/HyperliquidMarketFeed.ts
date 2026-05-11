import type { HyperliquidInfoApi } from "../../lib/hyperliquid/HyperliquidInfoApi.ts";
import type { HyperliquidSubscriptionApi } from "../../lib/hyperliquid/HyperliquidSubscriptionApi.ts";
import type { BookSnapshot, Unsubscribe } from "../../lib/hyperliquid/types.ts";
import type {
  IMarketFeed,
  MarketSnapshot,
  SnapshotListener,
} from "../../domain/ports/IMarketFeed.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

function computeMicroPrice(
  bestBid: number,
  bestAsk: number,
  bidSize: number,
  askSize: number,
): number {
  const denominator = bidSize + askSize;
  if (denominator === 0) {
    return (bestBid + bestAsk) / 2;
  }
  return (bestAsk * bidSize + bestBid * askSize) / denominator;
}

function computeMarginRatio(accountValue: number, totalMarginUsed: number): number | null {
  if (accountValue <= 0) {
    return null;
  }
  return Math.max(0, (accountValue - totalMarginUsed) / accountValue);
}

export class HyperliquidMarketFeed implements IMarketFeed {
  private readonly listeners = new Set<SnapshotListener>();
  private snapshot: MarketSnapshot | null = null;
  private pollTimer: Timer | null = null;
  private bookUnsub: Unsubscribe | null = null;
  private midsUnsub: Unsubscribe | null = null;

  constructor(
    private readonly info: HyperliquidInfoApi,
    private readonly subs: HyperliquidSubscriptionApi,
    private readonly params: {
      market: string;
      accountAddress?: string;
      pollIntervalMs?: number;
    },
  ) {}

  async connect(): Promise<void> {
    logger.info(`[adapter] HyperliquidMarketFeed | CONNECT | market=${this.params.market}`);
    await this.refreshSnapshot();
    this.startPolling();
    await this.startSubscriptions();
    logger.info(`[adapter] HyperliquidMarketFeed | CONNECTED | market=${this.params.market}`);
  }

  async disconnect(): Promise<void> {
    logger.info(`[adapter] HyperliquidMarketFeed | DISCONNECT | market=${this.params.market}`);
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.bookUnsub?.();
    await this.midsUnsub?.();
    this.bookUnsub = null;
    this.midsUnsub = null;
    logger.info(`[adapter] HyperliquidMarketFeed | DISCONNECTED | market=${this.params.market}`);
  }

  async getSnapshot(): Promise<MarketSnapshot> {
    if (this.snapshot === null) {
      await this.refreshSnapshot();
    }
    if (this.snapshot === null) {
      throw new Error("HyperliquidMarketFeed snapshot is unavailable");
    }
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.refreshSnapshot().catch((error) => {
        logger.warn(
          `[adapter] HyperliquidMarketFeed | REFRESH_FAILED | market=${this.params.market} error=${stringifyError(error)}`,
        );
      });
    }, this.params.pollIntervalMs ?? 1000);
    logger.info(
      `[adapter] HyperliquidMarketFeed | POLLING_STARTED | market=${this.params.market} intervalMs=${this.params.pollIntervalMs ?? 1000}`,
    );
  }

  private async startSubscriptions(): Promise<void> {
    this.bookUnsub = await this.subs.subscribeL2Book(this.params.market, (book) =>
      this.mergeBook(book),
    );

    this.midsUnsub = await this.subs.subscribeAllMids((mids) => {
      const mark = mids[this.params.market];
      if (mark !== undefined && this.snapshot !== null) {
        this.snapshot = {
          ...this.snapshot,
          markPrice: mark,
          timestamp: Date.now(),
          tickerUpdatedAt: Date.now(),
        };
        logger.debug(
          `[adapter] HyperliquidMarketFeed | MARK_UPDATED | market=${this.params.market} markPrice=${mark}`,
        );
        this.publish(this.snapshot);
      }
    });
    logger.info(
      `[adapter] HyperliquidMarketFeed | WS_SUBSCRIBED | market=${this.params.market} topics=l2Book,allMids`,
    );
  }

  private mergeBook(book: BookSnapshot): void {
    if (book.coin !== this.params.market || this.snapshot === null) {
      return;
    }
    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    if (!bestBid || !bestAsk) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      bestBid: bestBid.price,
      bestAsk: bestAsk.price,
      microPrice: computeMicroPrice(bestBid.price, bestAsk.price, bestBid.size, bestAsk.size),
      timestamp: book.time,
      bookUpdatedAt: book.time,
    };
    logger.debug(
      `[adapter] HyperliquidMarketFeed | BOOK_UPDATED | market=${this.params.market} bestBid=${this.snapshot.bestBid} bestAsk=${this.snapshot.bestAsk} microPrice=${this.snapshot.microPrice}`,
    );
    this.publish(this.snapshot);
  }

  private async refreshSnapshot(): Promise<void> {
    const [book, mids, marginRatio] = await Promise.all([
      this.info.getL2Book(this.params.market),
      this.info.getAllMids(),
      this.fetchMarginRatio(),
    ]);

    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    if (!bestBid || !bestAsk) {
      throw new Error(`No order book levels for ${this.params.market}`);
    }

    const stamp = marginRatio === null ? null : Date.now();
    const bumpFreshness = (prev: number | null): number | null => {
      if (stamp === null) {
        return prev ?? null;
      }
      if (prev === null) {
        return stamp;
      }
      return stamp > prev ? stamp : prev + 1;
    };
    this.snapshot = {
      market: this.params.market,
      bestBid: bestBid.price,
      bestAsk: bestAsk.price,
      microPrice: computeMicroPrice(bestBid.price, bestAsk.price, bestBid.size, bestAsk.size),
      markPrice: mids[this.params.market] ?? (bestBid.price + bestAsk.price) / 2,
      timestamp: book.time,
      bookUpdatedAt: book.time,
      tickerUpdatedAt: Date.now(),
      candleUpdatedAt: null,
      accountUpdatedAt: bumpFreshness(this.snapshot?.accountUpdatedAt ?? null),
      positionUpdatedAt: bumpFreshness(this.snapshot?.positionUpdatedAt ?? null),
      positionQty: null,
      marginRatio,
    };
    logger.info(
      `[adapter] HyperliquidMarketFeed | SNAPSHOT_SEEDED | market=${this.params.market} bestBid=${this.snapshot.bestBid} bestAsk=${this.snapshot.bestAsk} markPrice=${this.snapshot.markPrice} marginRatio=${this.snapshot.marginRatio}`,
    );
    this.publish(this.snapshot);
  }

  private async fetchMarginRatio(): Promise<number | null> {
    if (!this.params.accountAddress) {
      return null;
    }
    try {
      const state = await this.info.getClearinghouseState(this.params.accountAddress);
      return computeMarginRatio(state.accountValue, state.totalMarginUsed);
    } catch {
      return null;
    }
  }

  private publish(snapshot: MarketSnapshot): void {
    for (const listener of this.listeners) {
      void listener(snapshot);
    }
  }
}
