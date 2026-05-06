import type { MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import type { IOhlcvRepository, OhlcvRecord } from "../../domain/ports/IOhlcvRepository.ts";
import { logger } from "../../utils/logger.ts";

export class RecordOhlcvUseCase {
  private readonly candles = new Map<string, OhlcvRecord>();

  constructor(
    private readonly ohlcvRepository: IOhlcvRepository,
    private readonly timeframe = "1m",
    private readonly timeframeMs = 60_000,
  ) {}

  async execute(snapshot: MarketSnapshot): Promise<void> {
    if (!Number.isFinite(snapshot.markPrice)) {
      logger.warn(
        `record_ohlcv.skipped market=${snapshot.market} reason=invalid_mark_price price=${snapshot.markPrice}`,
      );
      return;
    }

    if (this.hasVenueCandle(snapshot)) {
      const candle: OhlcvRecord = {
        market: snapshot.market,
        timeframe: this.timeframe,
        ts: snapshot.timestamp,
        open: snapshot.open,
        high: snapshot.high,
        low: snapshot.low,
        close: snapshot.close,
        volume: snapshot.volume ?? 0,
      };
      this.candles.set(`${snapshot.market}:${this.timeframe}:${snapshot.timestamp}`, candle);
      await this.ohlcvRepository.saveMany([candle]);
      logger.debug(
        `record_ohlcv.saved market=${candle.market} timeframe=${candle.timeframe} ts=${candle.ts} close=${candle.close} volume=${candle.volume}`,
      );
      return;
    }

    if (snapshot.volume === undefined) {
      logger.debug(
        `record_ohlcv.skipped market=${snapshot.market} reason=top_of_book_snapshot ts=${snapshot.timestamp}`,
      );
      return;
    }

    const bucketTs = Math.floor(snapshot.timestamp / this.timeframeMs) * this.timeframeMs;
    const key = `${snapshot.market}:${this.timeframe}:${bucketTs}`;
    const cached = this.candles.get(key);
    const base = cached ?? (await this.loadOrCreate(snapshot, bucketTs));
    const volume = snapshot.volume;
    const candle: OhlcvRecord = {
      ...base,
      high: Math.max(base.high, snapshot.markPrice),
      low: Math.min(base.low, snapshot.markPrice),
      close: snapshot.markPrice,
      volume: base.volume + volume,
    };

    this.candles.set(key, candle);
    await this.ohlcvRepository.saveMany([candle]);
    logger.debug(
      `record_ohlcv.saved market=${candle.market} timeframe=${candle.timeframe} ts=${candle.ts} close=${candle.close} volume=${candle.volume}`,
    );
  }

  private async loadOrCreate(snapshot: MarketSnapshot, bucketTs: number): Promise<OhlcvRecord> {
    const [stored] = await this.ohlcvRepository.findByRange(
      snapshot.market,
      this.timeframe,
      bucketTs,
      bucketTs,
    );
    if (stored !== undefined) {
      return stored;
    }

    return {
      market: snapshot.market,
      timeframe: this.timeframe,
      ts: bucketTs,
      open: snapshot.markPrice,
      high: snapshot.markPrice,
      low: snapshot.markPrice,
      close: snapshot.markPrice,
      volume: 0,
    };
  }

  private hasVenueCandle(
    snapshot: MarketSnapshot,
  ): snapshot is MarketSnapshot &
    Required<Pick<MarketSnapshot, "open" | "high" | "low" | "close">> {
    return (
      snapshot.open !== undefined &&
      snapshot.high !== undefined &&
      snapshot.low !== undefined &&
      snapshot.close !== undefined
    );
  }
}
