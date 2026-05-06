import type { Fill } from "../../domain/entities/Fill.ts";

interface HourlyMarkoutBucket {
  hour: number;
  fillCount: number;
  markoutBpsAvg: number;
}

interface HourlySideCount {
  hour: number;
  buy: number;
  sell: number;
}

const HOURS = 24;

function emptyMarkoutBuckets(): HourlyMarkoutBucket[] {
  return Array.from({ length: HOURS }, (_, hour) => ({ hour, fillCount: 0, markoutBpsAvg: 0 }));
}

export function computeHourlyMarkoutBps(
  fills: ReadonlyArray<Fill>,
  horizon: "5s" | "30s" = "5s",
): HourlyMarkoutBucket[] {
  const buckets = emptyMarkoutBuckets();
  const sums: number[] = Array.from({ length: HOURS }, () => 0);
  for (const fill of fills) {
    const futurePrice = horizon === "5s" ? fill.markPrice5s : fill.markPrice30s;
    if (fill.markPriceAtFill === undefined || futurePrice === undefined) continue;
    if (fill.markPriceAtFill === 0) continue;
    const delta =
      fill.side === "buy" ? futurePrice - fill.markPriceAtFill : fill.markPriceAtFill - futurePrice;
    const bps = (delta / fill.markPriceAtFill) * 10_000;
    const hour = new Date(fill.filledAt).getUTCHours();
    const bucket = buckets[hour];
    if (bucket === undefined) continue;
    bucket.fillCount += 1;
    sums[hour] = (sums[hour] ?? 0) + bps;
  }
  for (let hour = 0; hour < HOURS; hour += 1) {
    const bucket = buckets[hour];
    if (bucket === undefined) continue;
    bucket.markoutBpsAvg = bucket.fillCount > 0 ? (sums[hour] ?? 0) / bucket.fillCount : 0;
  }
  return buckets;
}

export function computeHourlySideCounts(fills: ReadonlyArray<Fill>): HourlySideCount[] {
  const buckets: HourlySideCount[] = Array.from({ length: HOURS }, (_, hour) => ({
    hour,
    buy: 0,
    sell: 0,
  }));
  for (const fill of fills) {
    const hour = new Date(fill.filledAt).getUTCHours();
    const bucket = buckets[hour];
    if (bucket === undefined) continue;
    if (fill.side === "buy") bucket.buy += 1;
    else bucket.sell += 1;
  }
  return buckets;
}
