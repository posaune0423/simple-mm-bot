import type {
  IMarketFeed,
  MarketSnapshot,
  SnapshotListener,
} from "../../domain/ports/IMarketFeed.ts";
import type { IOhlcvRepository, OhlcvRecord } from "../../domain/ports/IOhlcvRepository.ts";
import { logger } from "../../utils/logger.ts";

interface HistoricalOhlcvFetcher {
  fetch(market: string, timeframe: string, from: number, to: number): Promise<OhlcvRecord[]>;
}

export class HistoricalMarketFeed implements IMarketFeed {
  private readonly listeners = new Set<SnapshotListener>();
  private records: Awaited<ReturnType<IOhlcvRepository["findByRange"]>> = [];
  private index = 0;

  constructor(
    private readonly ohlcvRepository: IOhlcvRepository,
    private readonly fetcher: HistoricalOhlcvFetcher,
    private readonly params: {
      market: string;
      timeframe: string;
      from: number;
      to: number;
    },
  ) {}

  async connect(): Promise<void> {
    logger.info(
      `historical_market_feed.connect market=${this.params.market} timeframe=${this.params.timeframe} from=${this.params.from} to=${this.params.to}`,
    );
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
    logger.info(
      `historical_market_feed.loaded market=${this.params.market} timeframe=${this.params.timeframe} candles=${this.records.length}`,
    );
    this.publishCurrent();
  }

  async disconnect(): Promise<void> {
    logger.info(`historical_market_feed.disconnected market=${this.params.market}`);
  }

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
      logger.info(
        `historical_market_feed.exhausted market=${this.params.market} candles=${this.records.length}`,
      );
      return false;
    }
    this.index += 1;
    logger.debug(
      `historical_market_feed.advanced market=${this.params.market} index=${this.index}`,
    );
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
