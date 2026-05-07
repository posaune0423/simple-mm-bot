import { describe, expect, test } from "bun:test";

import { BulkBetaLeaderboardStrategy } from "../../src/domain/strategy/bulk-beta-leaderboard/BulkBetaLeaderboardStrategy.ts";

const baseContext = {
  fairPrice: 100_000,
  sigma: 50,
  quoteSize: 0.01,
  positionQty: 0,
  inventoryScale: 0.08,
  timeHorizonSec: 10,
  slideMarginThreshold: 0.06,
  defaultTimeInForce: "GTC" as const,
  marginRatio: 0.5,
};

const params = {
  baseHalfSpreadBps: 2.5,
  minHalfSpreadBps: 1.2,
  maxHalfSpreadBps: 8,
  volatilitySpreadMultiplier: 1.5,
  inventorySoftLimitQty: 0.08,
  inventoryHardLimitQty: 0.18,
  sameSideSizeMultiplierAtSoft: 0.25,
  reduceSideSizeMultiplierAtSoft: 1.8,
};

describe("BulkBetaLeaderboardStrategy", () => {
  test("keeps flat quotes symmetric and applies the configured half spread bounds", () => {
    const quote = new BulkBetaLeaderboardStrategy(params).computeQuote(baseContext);

    expect(quote.policy).toBe("GTC");
    expect(quote.bidSize).toBe(0.01);
    expect(quote.askSize).toBe(0.01);
    expect(quote.bidSizeMultiplier).toBe(1);
    expect(quote.askSizeMultiplier).toBe(1);
    expect(quote.fairPrice - quote.bid).toBeCloseTo(80);
    expect(quote.ask - quote.fairPrice).toBeCloseTo(80);
  });

  test("thins same-side bids and thickens reducing asks when inventory is long", () => {
    const quote = new BulkBetaLeaderboardStrategy(params).computeQuote({
      ...baseContext,
      positionQty: 0.08,
    });

    expect(quote.bidSizeMultiplier).toBe(0.25);
    expect(quote.askSizeMultiplier).toBe(1.8);
    expect(quote.bidSize).toBeCloseTo(0.0025);
    expect(quote.askSize).toBeCloseTo(0.018);
    expect(baseContext.fairPrice - quote.bid).toBeGreaterThan(quote.ask - baseContext.fairPrice);
  });

  test("stops quoting the side that would add inventory beyond the hard limit", () => {
    const longQuote = new BulkBetaLeaderboardStrategy(params).computeQuote({
      ...baseContext,
      positionQty: 0.2,
    });
    const shortQuote = new BulkBetaLeaderboardStrategy(params).computeQuote({
      ...baseContext,
      positionQty: -0.2,
    });

    expect(longQuote.bidSize).toBe(0);
    expect(longQuote.askSize).toBeGreaterThan(0);
    expect(shortQuote.bidSize).toBeGreaterThan(0);
    expect(shortQuote.askSize).toBe(0);
  });
});
