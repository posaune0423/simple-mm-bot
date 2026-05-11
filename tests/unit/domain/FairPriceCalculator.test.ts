import { describe, expect, test } from "bun:test";

import {
  FairPriceCalculator,
  calculateDepthVampPrice,
} from "../../../src/domain/FairPriceCalculator.ts";
import type { MarketSnapshot } from "../../../src/domain/ports/IMarketFeed.ts";

const snapshot = (overrides: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  market: "BTC-USD",
  bestBid: 99,
  bestAsk: 101,
  microPrice: 100,
  markPrice: 100,
  timestamp: 1_700_000_000_000,
  marginRatio: null,
  ...overrides,
});

describe("calculateDepthVampPrice", () => {
  test("matches BBO microprice when only one valid level is available", () => {
    const vamp = calculateDepthVampPrice([{ bidPrice: 99, bidSize: 2, askPrice: 101, askSize: 1 }]);

    expect(vamp).toBeCloseTo(100.33333333333333);
  });

  test("uses multiple book levels with opposite-side size weighting", () => {
    const vamp = calculateDepthVampPrice([
      { bidPrice: 99, bidSize: 1, askPrice: 101, askSize: 5 },
      { bidPrice: 98, bidSize: 2, askPrice: 102, askSize: 4 },
    ]);

    expect(vamp).toBeCloseTo((99 * 5 + 98 * 4 + 101 * 1 + 102 * 2) / (1 + 2 + 5 + 4));
  });

  test("returns undefined when depth is missing or unusable", () => {
    expect(calculateDepthVampPrice([])).toBeUndefined();
    expect(
      calculateDepthVampPrice([{ bidPrice: 99, bidSize: 0, askPrice: 101, askSize: 0 }]),
    ).toBeUndefined();
    expect(
      calculateDepthVampPrice([{ bidPrice: 99, bidSize: 1, askPrice: Number.NaN, askSize: 1 }]),
    ).toBeUndefined();
  });
});

describe("FairPriceCalculator", () => {
  test("uses micro price by default", () => {
    const fair = new FairPriceCalculator(0.25).compute(
      snapshot({ microPrice: 100, vampPrice: 105, markPrice: 108 }),
    );

    expect(fair).toBe(102);
  });

  test("uses VAMP as the book price source when configured", () => {
    const fair = new FairPriceCalculator(0.25, "vamp").compute(
      snapshot({ microPrice: 100, vampPrice: 104, markPrice: 108 }),
    );

    expect(fair).toBe(105);
  });

  test("falls back to micro price when VAMP is unavailable", () => {
    const fair = new FairPriceCalculator(0.25, "vamp").compute(
      snapshot({ microPrice: 100, vampPrice: undefined, markPrice: 108 }),
    );

    expect(fair).toBe(102);
  });
});
