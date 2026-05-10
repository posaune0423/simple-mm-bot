import type { BulkClient } from "bulk-ts-sdk";

import type { OhlcvBar } from "./leadLagMath.ts";

export interface BulkKlinesRangeParams {
  client: BulkClient;
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  pageSize?: number;
}

const DEFAULT_PAGE = 1000;

/** Candle step in ms for supported Bulk intervals (see OpenAPI `CandleInterval`). */
export function intervalToMs(interval: string): number {
  const table: Record<string, number> = {
    "10s": 10_000,
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
    "3d": 259_200_000,
    "1w": 604_800_000,
    "1M": 2_592_000_000,
  };
  const ms = table[interval];
  if (ms === undefined) {
    throw new Error(`Unsupported Bulk interval "${interval}" for pagination`);
  }
  return ms;
}

export async function fetchBulkKlinesRange(params: BulkKlinesRangeParams): Promise<OhlcvBar[]> {
  const { client, symbol, interval, startTime, endTime } = params;
  const pageSize = params.pageSize ?? DEFAULT_PAGE;
  const step = intervalToMs(interval);
  const all: OhlcvBar[] = [];
  let cursor = startTime;

  while (cursor <= endTime) {
    const candles = await client.market.klines({
      symbol,
      interval,
      startTime: cursor,
      endTime,
      limit: pageSize,
    });
    if (candles.length === 0) {
      break;
    }
    for (const c of candles) {
      const ts = Number(c.t);
      const open = Number(c.o);
      const high = Number(c.h);
      const low = Number(c.l);
      const close = Number(c.c);
      const volume = Number(c.v);
      if (
        !Number.isFinite(ts) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        !Number.isFinite(volume)
      ) {
        continue;
      }
      if (ts >= startTime && ts <= endTime) {
        all.push({ ts, open, high, low, close, volume });
      }
    }
    const lastCandle = candles[candles.length - 1]!;
    const lastTs = Number(lastCandle.t);
    if (!Number.isFinite(lastTs)) {
      break;
    }
    const next = lastTs + step;
    if (next <= cursor) {
      break;
    }
    cursor = next;
    if (candles.length < pageSize) {
      break;
    }
  }

  all.sort((a, b) => a.ts - b.ts);
  return dedupeByTs(all);
}

function dedupeByTs(bars: OhlcvBar[]): OhlcvBar[] {
  const seen = new Set<number>();
  const out: OhlcvBar[] = [];
  for (const bar of bars) {
    if (seen.has(bar.ts)) {
      continue;
    }
    seen.add(bar.ts);
    out.push(bar);
  }
  return out;
}
