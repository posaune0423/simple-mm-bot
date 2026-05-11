import { describe, expect, test } from "bun:test";

import { computeDrawdown } from "../../../../src/lib/reporting/metrics/drawdown.ts";

describe("computeDrawdown", () => {
  test("tracks peak-to-trough as non-positive series", () => {
    const result = computeDrawdown([
      { timestamp: 1, value: 0 },
      { timestamp: 2, value: 5 },
      { timestamp: 3, value: 3 },
      { timestamp: 4, value: 8 },
      { timestamp: 5, value: 2 },
    ]);

    expect(result.map((point) => point.drawdown)).toEqual([0, 0, -2, 0, -6]);
  });

  test("returns empty for empty input", () => {
    expect(computeDrawdown([])).toEqual([]);
  });
});
