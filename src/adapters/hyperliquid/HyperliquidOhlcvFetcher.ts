import type { HyperliquidInfoApi } from "../../lib/hyperliquid/HyperliquidInfoApi.ts";
import type { OhlcvRecord } from "../../domain/ports/IOhlcvRepository.ts";

export class HyperliquidOhlcvFetcher {
  constructor(private readonly info: HyperliquidInfoApi) {}

  async fetch(market: string, timeframe: string, from: number, to: number): Promise<OhlcvRecord[]> {
    const candles = await this.info.getCandleSnapshot({
      coin: market,
      interval: timeframe,
      startTime: from,
      endTime: to,
    });

    return candles.map((candle) => ({
      market,
      timeframe,
      ts: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));
  }
}
