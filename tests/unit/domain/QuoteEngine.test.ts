import { describe, expect, test } from "bun:test";
import { ok } from "neverthrow";
import type { QuoteModel } from "../../../src/domain/quote-models/QuoteModel.ts";
import { ModelQuote } from "../../../src/domain/quote-models/QuoteModel.ts";
import { FairPriceCalculator } from "../../../src/domain/services/FairPriceCalculator.ts";
import { QuoteEngine } from "../../../src/domain/services/QuoteEngine.ts";
import { VolatilityEstimator } from "../../../src/domain/services/VolatilityEstimator.ts";
import type { IFairValueProvider } from "../../../src/domain/ports/IFairValueProvider.ts";
import type { MarketSnapshot } from "../../../src/domain/ports/IMarketFeed.ts";
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

  test("treats the configured residual target as flat for passive quotes", () => {
    const engine = new QuoteEngine(
      fixedModel(),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 1,
        timeHorizonSec: 1,
        minSpreadBps: 2,
        positionSize: 1,
        budgetUsd: 100_000,
        reduceQuoteMinPositionQty: 0.003,
      },
    );

    const residual = engine
      .compute({
        snapshot: snapshot(),
        position: position(-0.003),
        sideSpecs: {
          bid: sideSpec(),
          ask: sideSpec(),
        },
      })
      ._unsafeUnwrap();
    expect(residual.bids[0]?.exposureIntent).toBe("increase_exposure");
    expect(residual.asks[0]?.exposureIntent).toBe("increase_exposure");

    const longResidual = engine
      .compute({
        snapshot: snapshot(),
        position: position(0.003),
        sideSpecs: {
          bid: sideSpec(),
          ask: sideSpec(),
        },
      })
      ._unsafeUnwrap();
    expect(longResidual.bids[0]?.exposureIntent).toBe("increase_exposure");
    expect(longResidual.asks[0]?.exposureIntent).toBe("increase_exposure");

    const aboveTarget = engine
      .compute({
        snapshot: snapshot(),
        position: position(-0.004),
        sideSpecs: {
          bid: sideSpec(),
          ask: sideSpec(),
        },
      })
      ._unsafeUnwrap();
    expect(aboveTarget.bids[0]?.exposureIntent).toBe("reduce_exposure");
    expect(Number(aboveTarget.bids[0]?.size)).toBe(0.004);
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

  test("passes model signals through to QuoteModel", () => {
    let receivedAlpha: number | undefined;
    const model: QuoteModel = {
      name: "signal_test_model",
      compute(input) {
        receivedAlpha = input.signals?.alphaDriftBps ?? undefined;
        return fixedModel().compute(input);
      },
    };
    const engine = new QuoteEngine(model, new FairPriceCalculator(1), new VolatilityEstimator(), {
      inventoryScale: 1,
      timeHorizonSec: 1,
      minSpreadBps: 2,
      positionSize: 1,
    });

    const result = engine.compute({
      snapshot: snapshot(),
      position: position(0),
      sideSpecs: {
        bid: sideSpec(),
        ask: sideSpec(),
      },
      modelSignals: { alphaDriftBps: 1.5 },
    });

    expect(result.isOk()).toBe(true);
    expect(receivedAlpha).toBe(1.5);
  });

  test("uses external fair value diagnostics from FairPriceCalculator", () => {
    const engine = new QuoteEngine(
      fixedModel(),
      new FairPriceCalculator(1, "micro", fairValueProvider(110), {
        enabled: true,
        mode: "replace_local",
      }),
      new VolatilityEstimator(),
      {
        inventoryScale: 1,
        timeHorizonSec: 1,
        minSpreadBps: 2,
        positionSize: 1,
      },
    );

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
    expect(Number(quote.fairPrice)).toBe(110);
    expect(quote.diagnostics.fairPriceSource).toBe("external");
    expect(quote.diagnostics.localFairPrice).toBe(100);
    expect(quote.diagnostics.externalFair?.fairMid).toBe(110);
  });

  test("passes the decision wall-clock time to the external fair provider", () => {
    let receivedNowMs: number | undefined;
    const provider: IFairValueProvider = {
      getLatestFairValue(nowMs) {
        receivedNowMs = nowMs;
        return {
          status: "ready",
          computedAt: nowMs,
          fairBid: 109,
          fairAsk: 111,
          fairMid: 110,
          minAgeMs: 10,
          maxAgeMs: 10,
          used: [],
          excluded: [],
        };
      },
    };
    const engine = new QuoteEngine(
      fixedModel(),
      new FairPriceCalculator(1, "micro", provider, {
        enabled: true,
        mode: "replace_local",
      }),
      new VolatilityEstimator(),
      {
        inventoryScale: 1,
        timeHorizonSec: 1,
        minSpreadBps: 2,
        positionSize: 1,
      },
    );

    const result = engine.compute({
      snapshot: snapshot({ timestamp: 1_700_000_000_000 }),
      position: position(0),
      sideSpecs: {
        bid: sideSpec(),
        ask: sideSpec(),
      },
      nowMs: 1_700_000_000_750,
    });

    expect(result.isOk()).toBe(true);
    expect(receivedNowMs).toBe(1_700_000_000_750);
  });

  test("returns a no-quote condition when external fair value is unavailable", () => {
    const engine = new QuoteEngine(
      fixedModel(),
      new FairPriceCalculator(1, "micro", unavailableFairValueProvider(), {
        enabled: true,
        mode: "replace_local",
      }),
      new VolatilityEstimator(),
      {
        inventoryScale: 1,
        timeHorizonSec: 1,
        minSpreadBps: 2,
        positionSize: 1,
      },
    );

    const result = engine.compute({
      snapshot: snapshot(),
      position: position(0),
      sideSpecs: {
        bid: sideSpec(),
        ask: sideSpec(),
      },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: "quote_engine.quote_unavailable",
      message: "external fair value unavailable",
    });
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

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    market: "BTC-USD",
    bestBid: 99,
    bestAsk: 101,
    microPrice: 100,
    markPrice: 100,
    timestamp: 1,
    marginRatio: 1,
    availableMarginUsd: 100_000,
    ...overrides,
  };
}

function fairValueProvider(fairMid: number): IFairValueProvider {
  return {
    getLatestFairValue(nowMs) {
      return {
        status: "ready",
        computedAt: nowMs,
        fairBid: fairMid - 1,
        fairAsk: fairMid + 1,
        fairMid,
        minAgeMs: 0,
        maxAgeMs: 0,
        used: [],
        excluded: [],
      };
    },
  };
}

function unavailableFairValueProvider(): IFairValueProvider {
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
