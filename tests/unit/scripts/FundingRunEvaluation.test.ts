import { describe, expect, test } from "bun:test";

import { estimateFundingAccrual } from "../../../scripts/lib/FundingRunEvaluation.ts";

describe("estimateFundingAccrual", () => {
  test("charges longs when funding is positive", () => {
    const estimate = estimateFundingAccrual(
      [
        { observedAt: 0, positionQty: 1, markPrice: 100, fundingRateBps: 10 },
        { observedAt: 3_600_000, positionQty: 1, markPrice: 100, fundingRateBps: 10 },
      ],
      3_600_000,
      3600,
    );

    expect(estimate.fundingPnlUsd).toBeCloseTo(-0.1, 10);
    expect(estimate.coveredMs).toBe(3_600_000);
    expect(estimate.uncoveredMs).toBe(0);
    expect(estimate.averageFundingRateBps).toBe(10);
  });

  test("credits shorts when funding is positive and reports missing coverage", () => {
    const estimate = estimateFundingAccrual(
      [
        { observedAt: 0, positionQty: -0.5, markPrice: 200, fundingRateBps: 10 },
        { observedAt: 1_800_000, positionQty: -0.5, markPrice: 200, fundingRateBps: null },
        { observedAt: 3_600_000, positionQty: -0.5, markPrice: 200, fundingRateBps: null },
      ],
      3_600_000,
      3600,
    );

    expect(estimate.fundingPnlUsd).toBeCloseTo(0.05, 10);
    expect(estimate.coveredMs).toBe(1_800_000);
    expect(estimate.uncoveredMs).toBe(1_800_000);
  });
});
