import { describe, expect, test } from "bun:test";

import {
  FairPriceCalculator,
  calculateDepthVampPrice,
} from "../../../src/domain/services/FairPriceCalculator.ts";
import type { IFairValueProvider } from "../../../src/domain/ports/IFairValueProvider.ts";
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

  test("replaces local fair price with external fair value when configured", () => {
    const fair = new FairPriceCalculator(0.25, "micro", provider(110), {
      enabled: true,
      mode: "replace_local",
    }).computeWithDiagnostics(snapshot({ microPrice: 100, markPrice: 108 }), 1_700_000_000_050);

    expect(fair).toMatchObject({
      status: "ok",
      fairPrice: 110,
      localFairPrice: 102,
      priceSource: "external",
    });
    expect(fair.externalFair?.fairMid).toBe(110);
  });

  test("blends local and external fair value with normalized local weight", () => {
    const fair = new FairPriceCalculator(0.25, "micro", provider(110), {
      enabled: true,
      mode: "blend_with_local",
      localWeight: 0.25,
    }).computeWithDiagnostics(snapshot({ microPrice: 100, markPrice: 108 }), 1_700_000_000_050);

    expect(fair.status).toBe("ok");
    if (fair.status !== "ok") {
      throw new Error("Expected fair price computation to be ok");
    }
    expect(fair.fairPrice).toBe(108);
    expect(fair.priceSource).toBe("blended");
  });

  test("returns unavailable when external value is unavailable", () => {
    const fair = new FairPriceCalculator(0.25, "micro", unavailableProvider(), {
      enabled: true,
      mode: "replace_local",
    }).computeWithDiagnostics(snapshot({ microPrice: 100, markPrice: 108 }), 1_700_000_000_050);

    expect(fair).toMatchObject({
      status: "unavailable",
      reason: "external_fair_unavailable",
      localFairPrice: 102,
    });
  });

  test("returns unavailable when external value is non-finite", () => {
    const fair = new FairPriceCalculator(0.25, "micro", provider(Number.NaN), {
      enabled: true,
      mode: "blend_with_local",
    }).computeWithDiagnostics(snapshot({ microPrice: 100, markPrice: 108 }), 1_700_000_000_050);

    expect(fair).toMatchObject({
      status: "unavailable",
      reason: "external_fair_unavailable",
      localFairPrice: 102,
    });
  });
});

function provider(fairMid: number): IFairValueProvider {
  return {
    getLatestFairValue(nowMs) {
      return {
        status: "ready",
        computedAt: nowMs,
        fairBid: fairMid - 1,
        fairAsk: fairMid + 1,
        fairMid,
        minAgeMs: 50,
        maxAgeMs: 50,
        used: [],
        excluded: [],
      };
    },
  };
}

function unavailableProvider(): IFairValueProvider {
  return {
    getLatestFairValue(nowMs) {
      return {
        status: "unavailable",
        computedAt: nowMs,
        used: [],
        excluded: [],
      };
    },
  };
}
