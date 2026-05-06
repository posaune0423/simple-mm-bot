import { describe, expect, test } from "bun:test";

import { computeHourlyAdverseRate } from "../../../src/reporting/metrics/adverseRate.ts";
import { buildFill } from "../fixtures.ts";

describe("computeHourlyAdverseRate", () => {
  test("computes adverse rate as adverse_count / fill_count", () => {
    const fills = [
      buildFill({
        id: "a",
        side: "buy",
        filledAt: Date.UTC(2026, 0, 1, 7, 0, 0),
        markPriceAtFill: 100,
        markPrice5s: 99.5,
      }),
      buildFill({
        id: "b",
        side: "buy",
        filledAt: Date.UTC(2026, 0, 1, 7, 5, 0),
        markPriceAtFill: 100,
        markPrice5s: 100.4,
      }),
      buildFill({
        id: "c",
        side: "sell",
        filledAt: Date.UTC(2026, 0, 1, 7, 10, 0),
        markPriceAtFill: 100,
        markPrice5s: 100.4,
      }),
    ];
    const result = computeHourlyAdverseRate(fills);
    const hour7 = result[7];
    expect(hour7?.fillCount).toBe(3);
    expect(hour7?.adverseRate).toBeCloseTo(2 / 3);
  });
});
