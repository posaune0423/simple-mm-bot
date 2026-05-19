import { describe, expect, test } from "bun:test";
import { err, ok } from "neverthrow";

import { EmptyQuoteError, InvalidQuoteError } from "../../../src/domain/errors/DomainError.ts";
import type { QuoteModel } from "../../../src/domain/quote-models/QuoteModel.ts";
import type { IFairValueProvider } from "../../../src/domain/ports/IFairValueProvider.ts";
import { FairPriceCalculator } from "../../../src/domain/services/FairPriceCalculator.ts";
import { QuoteEngine } from "../../../src/domain/services/QuoteEngine.ts";
import { SimplePmmStrategy } from "../../../src/domain/strategies/SimplePmmStrategy.ts";
import { StrategyDecision } from "../../../src/domain/strategies/Strategy.ts";
import { VolatilityEstimator } from "../../../src/domain/services/VolatilityEstimator.ts";
import { PositionSnapshot } from "../../../src/domain/value-objects/PositionSnapshot.ts";
import { Price } from "../../../src/domain/value-objects/Price.ts";
import { Quantity } from "../../../src/domain/value-objects/Quantity.ts";
import { Quote } from "../../../src/domain/value-objects/Quote.ts";
import { QuoteLeg } from "../../../src/domain/value-objects/QuoteLeg.ts";
import type { QuoteEngineInput } from "../../../src/domain/services/QuoteEngine.ts";

class StubQuoteEngine {
  computeCalls: QuoteEngineInput[] = [];

  compute(input: QuoteEngineInput) {
    this.computeCalls.push(input);
    return ok(
      Quote.create({
        market: "BTC-USD",
        bids: [
          QuoteLeg.unsafe({
            side: "bid",
            price: Price.unsafe(99),
            size: Quantity.unsafe(1),
            level: 0,
            exposureIntent: "increase_exposure",
          }),
        ],
        asks: [
          QuoteLeg.unsafe({
            side: "ask",
            price: Price.unsafe(101),
            size: Quantity.unsafe(1),
            level: 0,
            exposureIntent: "increase_exposure",
          }),
        ],
        referencePrice: Price.unsafe(100),
        fairPrice: Price.unsafe(100),
        sigma: 0.01,
        diagnostics: {
          quoteModel: "stub",
          reasonTags: [],
        },
      })._unsafeUnwrap(),
    );
  }
}

class EmptyQuoteEngine {
  compute() {
    return err(new EmptyQuoteError());
  }
}

class InvalidQuoteEngine {
  compute() {
    return err(new InvalidQuoteError("crossed quote: bid=101, ask=100"));
  }
}

describe("SimplePmmStrategy", () => {
  test("returns quote decision from QuoteEngine result", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never);

    const result = strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [],
      nowMs: 1,
    });

    expect(result.isOk()).toBe(true);
    const decision = result._unsafeUnwrap();
    expect(
      StrategyDecision.match(decision, {
        quote: ({ quote }) => quote.bids.length === 1 && quote.asks.length === 1,
        noQuote: () => false,
      }),
    ).toBe(true);
  });

  test("matches no-quote decisions through the closed decision contract", () => {
    const decision = StrategyDecision.noQuote({
      cancelExisting: true,
      reasonTags: ["markout_gate"],
      diagnostics: { strategy: "simple-pmm" },
    });

    expect(
      StrategyDecision.match(decision, {
        quote: () => false,
        noQuote: ({ cancelExisting, reasonTags }) =>
          cancelExisting && reasonTags.includes("markout_gate"),
      }),
    ).toBe(true);
  });

  test("treats an empty quote as no-quote instead of a strategy failure", () => {
    const strategy = new SimplePmmStrategy(new EmptyQuoteEngine() as never);

    const result = strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [],
      nowMs: 1,
    });

    expect(result.isOk()).toBe(true);
    expect(
      StrategyDecision.match(result._unsafeUnwrap(), {
        quote: () => false,
        noQuote: ({ cancelExisting, reasonTags }) =>
          cancelExisting && reasonTags.includes("empty_quote"),
      }),
    ).toBe(true);
  });

  test("treats external fair gaps as no-quote instead of strategy failure", () => {
    const engine = new QuoteEngine(
      unusedQuoteModel(),
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
    const strategy = new SimplePmmStrategy(engine);

    const result = strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [],
      nowMs: 1_700_000_000_750,
    });

    expect(result.isOk()).toBe(true);
    expect(
      StrategyDecision.match(result._unsafeUnwrap(), {
        quote: () => false,
        noQuote: ({ cancelExisting, reasonTags }) =>
          cancelExisting && reasonTags.includes("external_fair_unavailable"),
      }),
    ).toBe(true);
  });

  test("keeps non-empty invalid quote errors as strategy failures", () => {
    const strategy = new SimplePmmStrategy(new InvalidQuoteEngine() as never);

    const result = strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [],
      nowMs: 1,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().cause).toBeInstanceOf(InvalidQuoteError);
  });

  test("failed buy quality disables bid increase exposure in QuoteEngineInput", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never, {
      markoutFeedbackGate: {
        enabled: true,
        minAverageMarkoutBps: 0,
        minSamples: 1,
        horizonsSec: [5],
      },
    });

    strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [
        {
          side: "buy",
          horizons: [{ horizonSec: 5, sampleCount: 2, averageMarkoutBps: -1 }],
        },
      ],
      nowMs: 1,
    });

    expect(quoteEngine.computeCalls[0]?.sideSpecs.bid.disableIncreaseExposure).toBe(true);
    expect(quoteEngine.computeCalls[0]?.sideSpecs.ask.disableIncreaseExposure).toBe(false);
  });

  test("uses VW markout and adverse selection to block toxic open sides", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never, {
      markoutFeedbackGate: {
        enabled: true,
        minAverageMarkoutBps: 0,
        maxAdverseSelectionRate: 0.45,
        minSamples: 8,
        horizonsSec: [5],
      },
    });

    strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 20,
              averageMarkoutBps: 0.2,
              weightedAverageMarkoutBps: -1.4,
              adverseSelectionRate: 0.65,
            },
          ],
        },
      ],
      nowMs: 1,
    });

    expect(quoteEngine.computeCalls[0]?.sideSpecs.ask.disableIncreaseExposure).toBe(true);
    expect(quoteEngine.computeCalls[0]?.sideSpecs.ask.reasonTags).toContain(
      "quality_gate:sell:5s_vw_markout_below_0bps",
    );
    expect(quoteEngine.computeCalls[0]?.sideSpecs.ask.reasonTags).toContain(
      "quality_gate:sell:5s_adverse_selection_above_45%",
    );
    expect(quoteEngine.computeCalls[0]?.sideSpecs.bid.disableIncreaseExposure).toBe(false);
  });

  test("can tag toxic sides without disabling quotes when volume preservation is required", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never, {
      markoutFeedbackGate: {
        enabled: true,
        action: "tag",
        minAverageMarkoutBps: 0,
        maxAdverseSelectionRate: 0.45,
        minSamples: 8,
        horizonsSec: [5],
      },
    });

    strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 20,
              averageMarkoutBps: 0.2,
              weightedAverageMarkoutBps: -1.4,
              adverseSelectionRate: 0.65,
            },
          ],
        },
      ],
      nowMs: 1,
    });

    const askSpec = quoteEngine.computeCalls[0]?.sideSpecs.ask;
    expect(askSpec?.disableIncreaseExposure).toBe(false);
    expect(askSpec?.reasonTags).toContain("quality_gate:sell:5s_vw_markout_below_0bps");
    expect(askSpec?.reasonTags).toContain("quality_gate:sell:5s_adverse_selection_above_45%");
  });

  test("rebalances toxic side distance and size while compensating the opposite side", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never, {
      markoutFeedbackGate: {
        enabled: true,
        action: "rebalance",
        minAverageMarkoutBps: 0,
        maxAdverseSelectionRate: 0.55,
        minSamples: 8,
        horizonsSec: [5, 30],
        toxicDistanceMultiplier: 1.2,
        toxicSizeMultiplier: 0.75,
        compensatingDistanceMultiplier: 0.9,
        compensatingSizeMultiplier: 1.25,
      },
    });

    strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 30,
              sampleCount: 20,
              averageMarkoutBps: -0.2,
              weightedAverageMarkoutBps: -1.4,
              adverseSelectionRate: 0.75,
            },
          ],
        },
        {
          side: "buy",
          horizons: [
            {
              horizonSec: 30,
              sampleCount: 20,
              averageMarkoutBps: 1.2,
              weightedAverageMarkoutBps: 1.4,
              adverseSelectionRate: 0.2,
            },
          ],
        },
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 20,
              averageMarkoutBps: 0.8,
              weightedAverageMarkoutBps: 0.9,
              adverseSelectionRate: 0.2,
            },
          ],
        },
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 20,
              averageMarkoutBps: 0.8,
              weightedAverageMarkoutBps: 0.9,
              adverseSelectionRate: 0.2,
            },
          ],
        },
      ],
      nowMs: 1,
    });

    const sideSpecs = quoteEngine.computeCalls[0]?.sideSpecs;
    expect(sideSpecs?.ask.disableIncreaseExposure).toBe(false);
    expect(sideSpecs?.ask.distanceMultiplier).toBe(1.2);
    expect(sideSpecs?.ask.sizeMultiplier).toBe(0.75);
    expect(sideSpecs?.bid.disableIncreaseExposure).toBe(false);
    expect(sideSpecs?.bid.distanceMultiplier).toBe(0.9);
    expect(sideSpecs?.bid.sizeMultiplier).toBe(1.25);
    expect(sideSpecs?.ask.reasonTags).toContain("quality_gate:sell:30s_vw_markout_below_0bps");
    expect(sideSpecs?.bid.reasonTags).toContain("quality_gate:buy:rebalance_against_sell");
  });

  test("can disable toxic open side while compensating opposite side during rebalance", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never, {
      markoutFeedbackGate: {
        enabled: true,
        action: "rebalance",
        minAverageMarkoutBps: 0,
        maxAdverseSelectionRate: 0.55,
        minSamples: 8,
        horizonsSec: [5, 30],
        toxicDistanceMultiplier: 1.65,
        toxicSizeMultiplier: 0.55,
        compensatingDistanceMultiplier: 0.35,
        compensatingSizeMultiplier: 1.6,
        disableToxicIncreaseExposure: true,
      },
    });

    strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [
        {
          side: "buy",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 20,
              averageMarkoutBps: -0.8,
              weightedAverageMarkoutBps: -0.9,
              adverseSelectionRate: 0.8,
            },
            {
              horizonSec: 30,
              sampleCount: 20,
              averageMarkoutBps: -0.4,
              weightedAverageMarkoutBps: -0.3,
              adverseSelectionRate: 0.6,
            },
          ],
        },
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 20,
              averageMarkoutBps: 0.8,
              weightedAverageMarkoutBps: 0.9,
              adverseSelectionRate: 0.2,
            },
          ],
        },
      ],
      nowMs: 1,
    });

    const sideSpecs = quoteEngine.computeCalls[0]?.sideSpecs;
    expect(sideSpecs?.bid.disableIncreaseExposure).toBe(true);
    expect(sideSpecs?.bid.distanceMultiplier).toBe(1.65);
    expect(sideSpecs?.bid.sizeMultiplier).toBe(0.55);
    expect(sideSpecs?.ask.disableIncreaseExposure).toBe(false);
    expect(sideSpecs?.ask.distanceMultiplier).toBe(0.35);
    expect(sideSpecs?.ask.sizeMultiplier).toBe(1.6);
    expect(sideSpecs?.ask.reasonTags).toEqual(["quality_gate:sell:rebalance_against_buy"]);
  });

  test("uses conservative compensation when the target side also fails quality gate", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never, {
      markoutFeedbackGate: {
        enabled: true,
        action: "rebalance",
        minAverageMarkoutBps: 0,
        maxAdverseSelectionRate: 0.55,
        minSamples: 1,
        horizonsSec: [30],
        toxicDistanceMultiplier: 1.2,
        toxicSizeMultiplier: 0.75,
        compensatingDistanceMultiplier: 0.9,
        compensatingSizeMultiplier: 1.25,
      },
    });

    strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [
        {
          side: "buy",
          horizons: [
            {
              horizonSec: 30,
              sampleCount: 20,
              averageMarkoutBps: -2.8,
              weightedAverageMarkoutBps: -3,
              adverseSelectionRate: 0.7,
            },
          ],
        },
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 30,
              sampleCount: 20,
              averageMarkoutBps: -0.1,
              weightedAverageMarkoutBps: -0.2,
              adverseSelectionRate: 0.56,
            },
          ],
        },
      ],
      nowMs: 1,
    });

    const sideSpecs = quoteEngine.computeCalls[0]?.sideSpecs;
    expect(sideSpecs?.bid.disableIncreaseExposure).toBe(false);
    expect(sideSpecs?.ask.disableIncreaseExposure).toBe(false);
    expect(sideSpecs?.bid.distanceMultiplier).toBe(1.2);
    expect(sideSpecs?.bid.sizeMultiplier).toBe(0.75);
    expect(sideSpecs?.ask.distanceMultiplier).toBe(0.95);
    expect(sideSpecs?.ask.sizeMultiplier).toBe(1);
    expect(sideSpecs?.bid.reasonTags).toContain("quality_gate:buy:30s_vw_markout_below_0bps");
    expect(sideSpecs?.ask.reasonTags).toEqual([
      "quality_gate:sell:conservative_rebalance_against_buy",
    ]);
  });

  test("uses conservative compensation until the opposite side has healthy evidence", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new SimplePmmStrategy(quoteEngine as never, {
      markoutFeedbackGate: {
        enabled: true,
        action: "rebalance",
        minAverageMarkoutBps: 0,
        maxAdverseSelectionRate: 0.55,
        minSamples: 4,
        horizonsSec: [5],
        toxicDistanceMultiplier: 1.65,
        toxicSizeMultiplier: 0.55,
        compensatingDistanceMultiplier: 0.35,
        compensatingSizeMultiplier: 1.6,
      },
    });

    strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [
        {
          side: "sell",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 4,
              averageMarkoutBps: -1.2,
              weightedAverageMarkoutBps: -1.4,
              adverseSelectionRate: 0.75,
            },
          ],
        },
        {
          side: "buy",
          horizons: [
            {
              horizonSec: 5,
              sampleCount: 3,
              averageMarkoutBps: 1.2,
              weightedAverageMarkoutBps: 1.4,
              adverseSelectionRate: 0.2,
            },
          ],
        },
      ],
      nowMs: 1,
    });

    const sideSpecs = quoteEngine.computeCalls[0]?.sideSpecs;
    expect(sideSpecs?.ask.distanceMultiplier).toBe(1.65);
    expect(sideSpecs?.ask.sizeMultiplier).toBe(0.55);
    expect(sideSpecs?.bid.distanceMultiplier).toBe(0.675);
    expect(sideSpecs?.bid.sizeMultiplier).toBe(1);
    expect(sideSpecs?.bid.reasonTags).toEqual([
      "quality_gate:buy:conservative_rebalance_against_sell",
    ]);
  });
});

function position(signedQuantity: number) {
  return PositionSnapshot.unsafe({
    market: "BTC-USD",
    signedQuantity,
    averageEntryPrice: null,
    unrealizedPnl: null,
  });
}

function unusedQuoteModel(): QuoteModel {
  return {
    name: "unused_test_model",
    compute() {
      throw new Error("external fair unavailability should stop before quote model computation");
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

function snapshot() {
  return {
    market: "BTC-USD",
    bestBid: 99,
    bestAsk: 101,
    microPrice: 100,
    markPrice: 100,
    timestamp: 1,
    marginRatio: null,
  };
}
