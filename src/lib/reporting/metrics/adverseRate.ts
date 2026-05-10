import type { ReportFill } from "../types.ts";

interface HourlyAdverseRate {
  hour: number;
  fillCount: number;
  adverseRate: number;
}

const HOURS = 24;

export function computeHourlyAdverseRate(fills: ReadonlyArray<ReportFill>): HourlyAdverseRate[] {
  const buckets: HourlyAdverseRate[] = Array.from({ length: HOURS }, (_, hour) => ({
    hour,
    fillCount: 0,
    adverseRate: 0,
  }));
  const adverseCounts: number[] = Array.from({ length: HOURS }, () => 0);
  for (const fill of fills) {
    if (fill.markPriceAtFill === undefined || fill.markPrice5s === undefined) continue;
    const delta =
      fill.side === "buy"
        ? fill.markPrice5s - fill.markPriceAtFill
        : fill.markPriceAtFill - fill.markPrice5s;
    const hour = new Date(fill.filledAt).getUTCHours();
    const bucket = buckets[hour];
    if (bucket === undefined) continue;
    bucket.fillCount += 1;
    if (delta < 0) adverseCounts[hour] = (adverseCounts[hour] ?? 0) + 1;
  }
  for (let hour = 0; hour < HOURS; hour += 1) {
    const bucket = buckets[hour];
    if (bucket === undefined) continue;
    bucket.adverseRate = bucket.fillCount > 0 ? (adverseCounts[hour] ?? 0) / bucket.fillCount : 0;
  }
  return buckets;
}
