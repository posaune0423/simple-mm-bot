import type { HyperliquidInfoApi } from "../../lib/hyperliquid/HyperliquidInfoApi.ts";
import type { HyperliquidSubscriptionApi } from "../../lib/hyperliquid/HyperliquidSubscriptionApi.ts";
import type { BookSnapshot, Unsubscribe } from "../../lib/hyperliquid/types.ts";
import type {
  IMarketFeed,
  MarketSnapshot,
  SnapshotListener,
} from "../../domain/ports/IMarketFeed.ts";

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
    await this.refreshSnapshot();
    this.startPolling();
    await this.startSubscriptions();
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.bookUnsub?.();
    await this.midsUnsub?.();
    this.bookUnsub = null;
    this.midsUnsub = null;
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
      void this.refreshSnapshot().catch(() => undefined);
    }, this.params.pollIntervalMs ?? 1000);
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
        };
        this.publish(this.snapshot);
      }
    });
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
    };
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

    this.snapshot = {
      market: this.params.market,
      bestBid: bestBid.price,
      bestAsk: bestAsk.price,
      microPrice: computeMicroPrice(bestBid.price, bestAsk.price, bestBid.size, bestAsk.size),
      markPrice: mids[this.params.market] ?? (bestBid.price + bestAsk.price) / 2,
      timestamp: book.time,
      marginRatio,
    };
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
