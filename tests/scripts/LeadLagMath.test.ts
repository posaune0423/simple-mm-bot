import { describe, expect, test } from "bun:test";

import {
  alignByTimestamp,
  bestLag,
  crossCorrAtLag,
  crossCorrSeries,
  logReturns,
  pearson,
} from "../../scripts/lib/leadLagMath.ts";

describe("leadLagMath", () => {
  test("logReturns matches ln(close_t/close_{t-1})", () => {
    const closes = [100, 110, 105];
    const r = logReturns(closes);
    expect(r.length).toBe(2);
    expect(r[0]).toBeCloseTo(Math.log(1.1), 8);
    expect(r[1]).toBeCloseTo(Math.log(105 / 110), 8);
  });

  test("pearson is 1 for identical series", () => {
    const xs = [1, 2, 3, 4, 5];
    const c = pearson(xs, xs);
    expect(c).toBeCloseTo(1, 8);
  });

  test("crossCorrAtLag detects shifted copy", () => {
    const x = [0, 0, 1, 0, 0, 0, 0];
    const y = [0, 0, 0, 1, 0, 0, 0];
    const c0 = crossCorrAtLag(x, y, 0);
    const c1 = crossCorrAtLag(x, y, 1);
    expect(c0 !== null && c1 !== null).toBe(true);
    expect(Math.abs(c1 ?? 0)).toBeGreaterThan(Math.abs(c0 ?? 0));
  });

  test("bestLag picks strongest correlation", () => {
    const series = crossCorrSeries([0, 1, 0, -1, 0], [0, 0, 1, 0, -1], 2);
    const peak = bestLag(series);
    expect(peak).not.toBeNull();
    expect(peak?.lag).toBe(1);
  });

  test("alignByTimestamp inner-joins on ts", () => {
    const left = [
      { ts: 1, open: 1, high: 1, low: 1, close: 10, volume: 1 },
      { ts: 2, open: 1, high: 1, low: 1, close: 20, volume: 1 },
    ];
    const right = [
      { ts: 2, open: 1, high: 1, low: 1, close: 200, volume: 1 },
      { ts: 3, open: 1, high: 1, low: 1, close: 300, volume: 1 },
    ];
    const a = alignByTimestamp(left, right);
    expect(a.ts).toEqual([2]);
    expect(a.left[0]!.close).toBe(20);
    expect(a.right[0]!.close).toBe(200);
  });
});
