import { describe, expect, test } from "bun:test";

import { buildQuoteModel } from "../../../src/application/factories/QuoteModelFactory";
import { AvellanedaStoikovQuoteModel } from "../../../src/domain/quote-models/AvellanedaStoikovQuoteModel";
import { FundingAwareQuoteModel } from "../../../src/domain/quote-models/FundingAwareQuoteModel";

describe("buildQuoteModel", () => {
  test("builds Avellaneda-Stoikov quote model from discriminated strategy config", () => {
    const model = buildQuoteModel({
      type: "avellaneda-stoikov",
      params: { gamma: 0.02, kappa: 1.5, kInv: 0.3 },
    });

    expect(model).toBeInstanceOf(AvellanedaStoikovQuoteModel);
    expect(model.name).toBe("avellaneda-stoikov");
  });

  test("does not build legacy ladder strategy types as active quote models", () => {
    expect(() =>
      buildQuoteModel({
        type: "bulk-beta-leaderboard",
        params: {},
      } as never),
    ).toThrow("Pattern matching error");
  });

  test("builds funding-aware quote model from strategy config", () => {
    const model = buildQuoteModel({
      type: "funding-aware",
      params: {
        gamma: 0,
        kappa: 625,
        kInv: 2,
        alpha: {
          enabled: false,
          source: "none",
          chainSlug: "testnet",
          asset: "BTC",
          timeframe: "5m",
          pollIntervalMs: 60_000,
          staleMs: 420_000,
          calibrationWeight: 0.04,
          minAlphaDriftBps: 0.25,
          maxAlphaDriftBps: 3,
          maxRawDriftBps: 200,
          maxCiWidthBps: 250,
        },
        targetInventory: {
          maxQty: 0.35,
          alphaQtyPerBps: 0.025,
        },
        funding: {
          rateHorizonSec: 3600,
          holdingHorizonSec: 300,
          spreadWideningBpsPerAbsFundingBps: 0.1,
        },
      },
    });

    expect(model).toBeInstanceOf(FundingAwareQuoteModel);
    expect(model.name).toBe("funding-aware");
  });
});
