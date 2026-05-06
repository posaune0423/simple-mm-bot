import type { Candle as BulkCandle } from "bulk-ts-sdk";

import type { OhlcvRecord } from "../../domain/ports/IOhlcvRepository.ts";

interface BulkKlinesClient {
  market: {
    klines(params: {
      symbol: string;
      interval: string;
      startTime?: number;
      endTime?: number;
      limit?: number;
    }): Promise<BulkCandle[]>;
  };
}

export class BulkOhlcvFetcher {
  constructor(private readonly client: BulkKlinesClient) {}

  async fetch(market: string, timeframe: string, from: number, to: number): Promise<OhlcvRecord[]> {
    const candles = await this.client.market.klines({
      symbol: market,
      interval: timeframe,
      startTime: from,
      endTime: to,
    });

    return candles
      .map((candle) => toOhlcvRecord(candle, market, timeframe))
      .filter((record): record is OhlcvRecord => record !== null);
  }
}

function toOhlcvRecord(candle: BulkCandle, market: string, timeframe: string): OhlcvRecord | null {
  const ts = Number(candle.t);
  const open = Number(candle.o);
  const high = Number(candle.h);
  const low = Number(candle.l);
  const close = Number(candle.c);
  const volume = Number(candle.v);
  if (
    !Number.isFinite(ts) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume)
  ) {
    return null;
  }

  return {
    market,
    timeframe,
    ts,
    open,
    high,
    low,
    close,
    volume,
  };
}
