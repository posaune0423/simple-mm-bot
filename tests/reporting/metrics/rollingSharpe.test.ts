import { describe, expect, test } from "bun:test";

import { computeRollingSharpe } from "../../../src/reporting/metrics/rollingSharpe.ts";
import { buildFill } from "../fixtures.ts";

describe("computeRollingSharpe", () => {
  test("returns empty when fills are below the window", () => {
    const fills = Array.from({ length: 3 }, (_, i) => buildFill({ id: `${i}`, filledAt: i }));
    expect(computeRollingSharpe(fills, 5)).toEqual([]);
  });

  test("emits one point per window position", () => {
    const fills = Array.from({ length: 10 }, (_, i) =>
      buildFill({
        id: `${i}`,
        filledAt: i,
        tradePnl: i % 2 === 0 ? 1 : -0.4,
        fee: 0,
      }),
    );
    const result = computeRollingSharpe(fills, 5);
    expect(result.length).toBe(6);
    expect(result[0]?.timestamp).toBe(4);
    expect(Number.isFinite(result[0]?.sharpe ?? Number.NaN)).toBe(true);
  });

  test("zero variance window yields sharpe 0", () => {
    const fills = Array.from({ length: 5 }, (_, i) =>
      buildFill({ id: `${i}`, filledAt: i, tradePnl: 1, fee: 0 }),
    );
    const result = computeRollingSharpe(fills, 5);
    expect(result).toEqual([{ timestamp: 4, sharpe: 0 }]);
  });
});
