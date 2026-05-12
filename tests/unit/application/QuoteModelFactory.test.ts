import { describe, expect, test } from "bun:test";

import { buildQuoteModel } from "../../../src/application/factories/QuoteModelFactory";
import { AvellanedaStoikovQuoteModel } from "../../../src/domain/quote-models/AvellanedaStoikovQuoteModel";

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
    ).toThrow("Unsupported quote model type: bulk-beta-leaderboard");
  });
});
