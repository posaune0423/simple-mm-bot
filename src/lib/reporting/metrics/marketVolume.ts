import type { ReportFill } from "../types.ts";

interface MarketVolume {
  market: string;
  notional: number;
  fillCount: number;
}

export function computeMarketVolume(fills: ReadonlyArray<ReportFill>): MarketVolume[] {
  const totals = new Map<string, MarketVolume>();
  for (const fill of fills) {
    const existing = totals.get(fill.market) ?? {
      market: fill.market,
      notional: 0,
      fillCount: 0,
    };
    existing.notional += fill.price * fill.qty;
    existing.fillCount += 1;
    totals.set(fill.market, existing);
  }
  return Array.from(totals.values()).sort((a, b) => b.notional - a.notional);
}

interface FeeVsPnlPoint {
  hour: number;
  fee: number;
  tradePnl: number;
  netPnl: number;
}

const HOURS = 24;

export function computeFeeVsPnl(fills: ReadonlyArray<ReportFill>): FeeVsPnlPoint[] {
  const buckets: FeeVsPnlPoint[] = Array.from({ length: HOURS }, (_, hour) => ({
    hour,
    fee: 0,
    tradePnl: 0,
    netPnl: 0,
  }));
  for (const fill of fills) {
    const hour = new Date(fill.filledAt).getUTCHours();
    const bucket = buckets[hour];
    if (bucket === undefined) continue;
    bucket.fee += fill.fee;
    bucket.tradePnl += fill.tradePnl;
    bucket.netPnl += fill.tradePnl - fill.fee;
  }
  return buckets;
}
