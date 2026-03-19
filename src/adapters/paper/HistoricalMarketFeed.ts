import type {
  IMarketFeed,
  MarketSnapshot,
  SnapshotListener,
} from "../../domain/ports/IMarketFeed.ts";
import type { IOhlcvRepository } from "../../domain/ports/IOhlcvRepository.ts";
import type { HyperliquidOhlcvFetcher } from "../hyperliquid/HyperliquidOhlcvFetcher.ts";

export class HistoricalMarketFeed implements IMarketFeed {
  private readonly listeners = new Set<SnapshotListener>();
  private records: Awaited<ReturnType<IOhlcvRepository["findByRange"]>> = [];
  private index = 0;

  constructor(
    private readonly ohlcvRepository: IOhlcvRepository,
    private readonly fetcher: HyperliquidOhlcvFetcher,
    private readonly params: {
      market: string;
      timeframe: string;
      from: number;
      to: number;
    },
  ) {}

  async connect(): Promise<void> {
    this.records = await this.ohlcvRepository.findByRange(
      this.params.market,
      this.params.timeframe,
      this.params.from,
      this.params.to,
    );
    if (this.records.length === 0) {
      this.records = await this.fetcher.fetch(
        this.params.market,
        this.params.timeframe,
        this.params.from,
        this.params.to,
      );
      await this.ohlcvRepository.saveMany(this.records);
    }
    if (this.records.length === 0) {
      throw new Error(
        `HistoricalMarketFeed found no candles for ${this.params.market} ${this.params.timeframe} in ${new Date(this.params.from).toISOString()} - ${new Date(this.params.to).toISOString()}`,
      );
    }
    this.records.sort((left, right) => left.ts - right.ts);
    this.index = 0;
    this.publishCurrent();
  }

  async disconnect(): Promise<void> {}

  async getSnapshot(): Promise<MarketSnapshot> {
    if (this.records.length === 0) {
      throw new Error("HistoricalMarketFeed has no records loaded");
    }
    const current = this.records[Math.min(this.index, this.records.length - 1)]!;
    return {
      market: current.market,
      bestBid: current.close * 0.9995,
      bestAsk: current.close * 1.0005,
      microPrice: current.close,
      markPrice: current.close,
      timestamp: current.ts,
      open: current.open,
      high: current.high,
      low: current.low,
      close: current.close,
      volume: current.volume,
      marginRatio: null,
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async advance(): Promise<boolean> {
    if (this.index >= this.records.length - 1) {
      return false;
    }
    this.index += 1;
    this.publishCurrent();
    return true;
  }

  private publishCurrent(): void {
    void this.getSnapshot().then((snapshot) => {
      for (const listener of this.listeners) {
        void listener(snapshot);
      }
    });
  }
}
