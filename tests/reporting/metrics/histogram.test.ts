import { describe, expect, test } from "bun:test";

import { computeHistogram } from "../../../src/reporting/metrics/histogram.ts";

describe("computeHistogram", () => {
  test("returns equal-width bins covering min..max", () => {
    const bins = computeHistogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(bins.length).toBe(5);
    expect(bins[0]?.lo).toBe(0);
    expect(bins.at(-1)?.hi).toBe(10);
    const total = bins.reduce((sum, bin) => sum + bin.count, 0);
    expect(total).toBe(11);
  });

  test("returns empty for empty input", () => {
    expect(computeHistogram([], 5)).toEqual([]);
  });

  test("handles all-equal values without dividing by zero", () => {
    const bins = computeHistogram([3, 3, 3, 3], 4);
    expect(bins.length).toBe(4);
    const total = bins.reduce((sum, bin) => sum + bin.count, 0);
    expect(total).toBe(4);
  });
});
