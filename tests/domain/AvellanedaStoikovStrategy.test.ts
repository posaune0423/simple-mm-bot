import { describe, expect, test } from "bun:test";

import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";

describe("AvellanedaStoikovStrategy", () => {
  test("uses fixed spread behavior when gamma is zero", () => {
    const strategy = new AvellanedaStoikovStrategy({
      gamma: 0,
      kappa: 2,
      kInv: 0.3,
    });

    const quote = strategy.computeQuote({
      fairPrice: 100,
      sigma: 0.5,
      quoteSize: 0.01,
      positionQty: 0,
      inventoryScale: 0.05,
      timeHorizonSec: 30,
      slideMarginThreshold: 0.12,
      marginRatio: 0.2,
    });

    expect(Number((quote.ask - quote.bid).toFixed(6))).toBe(1);
  });

  test("is symmetric when inventory skew is disabled", () => {
    const strategy = new AvellanedaStoikovStrategy({
      gamma: 0.02,
      kappa: 1.5,
      kInv: 0,
    });

    const quote = strategy.computeQuote({
      fairPrice: 200,
      sigma: 0.2,
      quoteSize: 0.01,
      positionQty: 3,
      inventoryScale: 0.05,
      timeHorizonSec: 30,
      slideMarginThreshold: 0.12,
      marginRatio: 0.2,
    });

    expect(Number(((quote.ask + quote.bid) / 2 - 200).toFixed(8))).toBe(0);
  });
});
