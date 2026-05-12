import { describe, expect, test } from "bun:test";

import { VolatilityEstimator } from "../../../src/domain/services/VolatilityEstimator.ts";

describe("VolatilityEstimator", () => {
  test("ignores non-monotonic timestamps instead of treating them as a 1ms move", () => {
    const estimator = new VolatilityEstimator();
    estimator.update(100, 10_000);
    const baseline = estimator.update(100.01, 11_000);

    const afterBackwardTimestamp = estimator.update(100.02, 10_500);

    expect(afterBackwardTimestamp).toBe(baseline);
  });

  test("ignores invalid timestamps without poisoning the next update", () => {
    const estimator = new VolatilityEstimator();

    expect(estimator.update(100, Number.NaN)).toBe(0);
    expect(estimator.update(100.01, 10_000)).toBe(0);
    expect(estimator.update(100.02, 11_000)).toBeGreaterThan(0);
  });
});
