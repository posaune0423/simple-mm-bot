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

export interface BulkMarketFeedClient {
  market: BulkMarketClient;
  account: BulkAccountClient;
  ws: BulkWsClient;
}

export interface BulkMarketFeedParams {
  market: string;
  nlevels?: number;
  accountId?: string;
}

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

function dataOf(message: unknown): Record<string, unknown> {
  if (typeof message !== "object" || message === null) {
    return {};
  }
  const record = message as Record<string, unknown>;
  const data = record.data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : record;
}

export class BulkMarketFeed implements IMarketFeed {
  private readonly listeners = new Set<SnapshotListener>();
  private readonly unsubscribers: Array<() => Promise<void>> = [];
  private snapshot: MarketSnapshot | null = null;

  constructor(
    private readonly client: BulkMarketFeedClient,
    private readonly params: BulkMarketFeedParams,
  ) {}

  async connect(): Promise<void> {
    await this.refreshSnapshot();
    await this.subscribeWs();
  }

  async disconnect(): Promise<void> {
    const results = await Promise.allSettled(
      this.unsubscribers.splice(0).map(async (unsubscribe) => unsubscribe()),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(`BulkMarketFeed.disconnect unsubscribe failed: ${String(result.reason)}`);
      }
    }
    await this.client.ws.close();
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
    this.unsubscribers.push(
      async () => ticker.unsubscribe(),
      async () => book.unsubscribe(),
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
    const data = dataOf(message);
    const markPrice = Number(data.markPrice ?? data.fairBookPx ?? data.lastPrice);
    if (!Number.isFinite(markPrice)) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      markPrice,
      timestamp: nsToMs(typeof data.timestamp === "number" ? data.timestamp : undefined),
    };
    this.publish(this.snapshot);
  }

  private mergeBook(message: unknown): void {
    if (this.snapshot === null) {
      return;
    }
    const data = dataOf(message) as BulkBook;
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
      ...this.snapshot,
      bestBid,
      bestAsk,
      microPrice: microPrice(bestBid, bestAsk, levelSize(bidLevel), levelSize(askLevel)),
      timestamp: nsToMs(data.timestamp),
    };
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
    try {
      const account = await this.client.account.fullAccount(this.params.accountId);
      const totalBalance = account.margin?.totalBalance;
      const marginUsed = account.margin?.marginUsed;
      if (totalBalance === undefined || totalBalance <= 0 || marginUsed === undefined) {
        return null;
      }
      return Math.max(0, (totalBalance - marginUsed) / totalBalance);
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
