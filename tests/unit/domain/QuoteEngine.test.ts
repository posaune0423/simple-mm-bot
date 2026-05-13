import { describe, expect, test } from "bun:test";
import { ok } from "neverthrow";
import type { QuoteModel } from "../../../src/domain/quote-models/QuoteModel.ts";
import { ModelQuote } from "../../../src/domain/quote-models/QuoteModel.ts";
import { FairPriceCalculator } from "../../../src/domain/services/FairPriceCalculator.ts";
import { QuoteEngine } from "../../../src/domain/services/QuoteEngine.ts";
import { VolatilityEstimator } from "../../../src/domain/services/VolatilityEstimator.ts";
import { PositionSnapshot } from "../../../src/domain/value-objects/PositionSnapshot.ts";
import { Price } from "../../../src/domain/value-objects/Price.ts";

describe("QuoteEngine", () => {
  test("computes a value-object quote through QuoteModel and side specs", () => {
    const engine = createEngine();

    const result = engine.compute({
      snapshot: snapshot(),
      position: position(0),
      sideSpecs: {
        bid: sideSpec(),
        ask: sideSpec(),
      },
    });

    expect(result.isOk()).toBe(true);
    const quote = result._unsafeUnwrap();
    expect(quote.bids).toHaveLength(1);
    expect(quote.asks).toHaveLength(1);
    expect(quote.bids[0]?.exposureIntent).toBe("increase_exposure");
    expect(quote.asks[0]?.exposureIntent).toBe("increase_exposure");
    expect(quote.diagnostics.quoteModel).toBe("fixed_test_model");
  });

  test("removes only increase exposure legs when side spec disables increase exposure", () => {
    const engine = createEngine();

    const flat = engine
      .compute({
        snapshot: snapshot(),
        position: position(0),
        sideSpecs: {
          bid: { ...sideSpec(), disableIncreaseExposure: true },
          ask: sideSpec(),
        },
      })
      ._unsafeUnwrap();
    expect(flat.bids).toHaveLength(0);
    expect(flat.asks).toHaveLength(1);

    const short = engine
      .compute({
        snapshot: snapshot(),
        position: position(-0.5),
        sideSpecs: {
          bid: { ...sideSpec(), disableIncreaseExposure: true },
          ask: { ...sideSpec(), disableIncreaseExposure: true },
        },
      })
      ._unsafeUnwrap();
    expect(short.bids[0]?.exposureIntent).toBe("reduce_exposure");
    expect(short.asks).toHaveLength(0);
  });

  test("caps reduce exposure quantity by current position", () => {
    const engine = createEngine();
    const quote = engine
      .compute({
        snapshot: snapshot(),
        position: position(-0.25),
        sideSpecs: {
          bid: sideSpec(),
          ask: sideSpec(),
        },
      })
      ._unsafeUnwrap();

    expect(quote.bids[0]?.exposureIntent).toBe("reduce_exposure");
    expect(Number(quote.bids[0]?.size)).toBe(0.25);
  });

  test("excludes disabled increase sides from open-notional cap totals", () => {
    const engine = new QuoteEngine(
      fixedModel(),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 1,
        timeHorizonSec: 1,
        minSpreadBps: 2,
        positionSize: 1,
        maxLeverage: 1,
      },
    );

    const quote = engine
      .compute({
        snapshot: { ...snapshot(), availableMarginUsd: 100 },
        position: position(0),
        sideSpecs: {
          bid: { ...sideSpec(), enabled: false },
          ask: sideSpec(),
        },
      })
      ._unsafeUnwrap();

    expect(quote.bids).toHaveLength(0);
    expect(Number(quote.asks[0]?.size)).toBeCloseTo(0.95);
  });
});

function createEngine(): QuoteEngine {
  return new QuoteEngine(fixedModel(), new FairPriceCalculator(1), new VolatilityEstimator(), {
    inventoryScale: 1,
    timeHorizonSec: 1,
    minSpreadBps: 2,
    positionSize: 1,
    budgetUsd: 100_000,
  });
}

function fixedModel(): QuoteModel {
  return {
    name: "fixed_test_model",
    compute(input) {
      return ok(
        ModelQuote.create({
          bidPrice: Price.unsafe(input.fairPrice - 1),
          askPrice: Price.unsafe(input.fairPrice + 1),
          bidQuantity: input.quoteSize,
          askQuantity: input.quoteSize,
          fairPrice: input.fairPrice,
          reservationPrice: input.fairPrice,
          diagnostics: {
            modelName: "fixed_test_model",
            volatilitySigma: input.volatilitySigma,
          },
        })._unsafeUnwrap(),
      );
    },
  };
}

function sideSpec() {
  return {
    enabled: true,
    distanceMultiplier: 1,
    sizeMultiplier: 1,
    disableIncreaseExposure: false,
    reasonTags: [],
  };
}

function position(signedQuantity: number) {
  return PositionSnapshot.unsafe({
    market: "BTC-USD",
    signedQuantity,
    averageEntryPrice: null,
    unrealizedPnl: null,
  });
}

function snapshot() {
  return {
    market: "BTC-USD",
    bestBid: 99,
    bestAsk: 101,
    microPrice: 100,
    markPrice: 100,
    timestamp: 1,
    marginRatio: 1,
    availableMarginUsd: 100_000,
  };
}
