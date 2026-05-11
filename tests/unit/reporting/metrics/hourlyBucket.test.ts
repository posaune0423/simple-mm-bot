import { describe, expect, test } from "bun:test";

import {
  computeHourlyMarkoutBps,
  computeHourlySideCounts,
} from "../../../../src/lib/reporting/metrics/hourlyBucket.ts";
import { buildFill } from "../fixtures.ts";

describe("computeHourlyMarkoutBps", () => {
  test("groups by UTC hour and averages markout in bps", () => {
    const fills = [
      buildFill({
        id: "a",
        side: "buy",
        filledAt: Date.UTC(2026, 0, 1, 3, 0, 0),
        markPriceAtFill: 100,
        markPrice5s: 100.1,
      }),
      buildFill({
        id: "b",
        side: "sell",
        filledAt: Date.UTC(2026, 0, 1, 3, 30, 0),
        markPriceAtFill: 100,
        markPrice5s: 99.9,
      }),
    ];
    const result = computeHourlyMarkoutBps(fills, "5s");
    expect(result.length).toBe(24);
    const hour3 = result[3];
    expect(hour3?.fillCount).toBe(2);
    expect(hour3?.markoutBpsAvg).toBeCloseTo(10);
  });

  test("skips fills missing markout data", () => {
    const fills = [
      buildFill({
        id: "x",
        filledAt: Date.UTC(2026, 0, 1, 0, 0, 0),
        markPriceAtFill: undefined,
        markPrice5s: 100,
      }),
    ];
    const result = computeHourlyMarkoutBps(fills, "5s");
    expect(result[0]?.fillCount).toBe(0);
  });
});

describe("computeHourlySideCounts", () => {
  test("counts buys and sells per hour", () => {
    const fills = [
      buildFill({ id: "a", side: "buy", filledAt: Date.UTC(2026, 0, 1, 5, 0, 0) }),
      buildFill({ id: "b", side: "buy", filledAt: Date.UTC(2026, 0, 1, 5, 30, 0) }),
      buildFill({ id: "c", side: "sell", filledAt: Date.UTC(2026, 0, 1, 5, 45, 0) }),
    ];
    const result = computeHourlySideCounts(fills);
    expect(result[5]).toEqual({ hour: 5, buy: 2, sell: 1 });
  });
});
