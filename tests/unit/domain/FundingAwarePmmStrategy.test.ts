import { describe, expect, test } from "bun:test";
import { err, ok } from "neverthrow";

import { EmptyQuoteError, InvalidQuoteError } from "../../../src/domain/errors/DomainError.ts";
import type { QuoteEngineInput } from "../../../src/domain/services/QuoteEngine.ts";
import { FundingAwarePmmStrategy } from "../../../src/domain/strategies/FundingAwarePmmStrategy.ts";
import { StrategyDecision } from "../../../src/domain/strategies/Strategy.ts";
import { PositionSnapshot } from "../../../src/domain/value-objects/PositionSnapshot.ts";
import { Price } from "../../../src/domain/value-objects/Price.ts";
import { Quantity } from "../../../src/domain/value-objects/Quantity.ts";
import { Quote } from "../../../src/domain/value-objects/Quote.ts";
import { QuoteLeg } from "../../../src/domain/value-objects/QuoteLeg.ts";

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
            reasonTags: input.sideSpecs.bid.reasonTags,
          }),
        ],
        asks: [
          QuoteLeg.unsafe({
            side: "ask",
            price: Price.unsafe(101),
            size: Quantity.unsafe(1),
            level: 0,
            exposureIntent: "increase_exposure",
            reasonTags: input.sideSpecs.ask.reasonTags,
          }),
        ],
        referencePrice: Price.unsafe(100),
        fairPrice: Price.unsafe(100),
        sigma: 0.01,
        diagnostics: {
          quoteModel: "funding-aware",
          reasonTags: [...input.sideSpecs.bid.reasonTags, ...input.sideSpecs.ask.reasonTags],
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

describe("FundingAwarePmmStrategy", () => {
  test("builds funding, basis, alpha, and target inventory signals", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new FundingAwarePmmStrategy(quoteEngine as never, config(), {
      current: () => ({ alphaDriftBps: 2, updatedAtMs: 1 }),
    });

    const result = strategy.decide({
      snapshot: {
        ...snapshot(),
        indexPrice: 99,
        oraclePrice: 101,
        fundingRateBps: 36,
      },
      position: position(0),
      markoutFeedback: [],
      nowMs: 1,
    });

    expect(result.isOk()).toBe(true);
    const signals = quoteEngine.computeCalls[0]?.modelSignals;
    expect(signals?.alphaDriftBps).toBe(2);
    expect(signals?.expectedFundingBps).toBe(3);
    expect(signals?.basisBps).toBeCloseTo(((101 - 99) / 99) * 10_000);
    expect(signals?.targetInventoryQty).toBeCloseTo(0.05);
  });

  test("keeps paper-style neutral target inventory when alpha is disabled", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new FundingAwarePmmStrategy(quoteEngine as never, {
      ...config(),
      alpha: { enabled: false, source: "none" },
    });

    const result = strategy.decide({
      snapshot: {
        ...snapshot(),
        indexPrice: 99,
        oraclePrice: 101,
        fundingRateBps: 36,
      },
      position: position(0),
      markoutFeedback: [],
      nowMs: 1,
    });

    expect(result.isOk()).toBe(true);
    const signals = quoteEngine.computeCalls[0]?.modelSignals;
    expect(signals?.alphaDriftBps).toBe(0);
    expect(signals?.fundingRateBps).toBe(36);
    expect(signals?.expectedFundingBps).toBe(3);
    expect(signals?.basisBps).toBeCloseTo(((101 - 99) / 99) * 10_000);
    expect(signals?.targetInventoryQty).toBe(0);
  });

  test("treats an empty quote as no-quote instead of a strategy failure", () => {
    const strategy = new FundingAwarePmmStrategy(new EmptyQuoteEngine() as never, config());

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

  test("keeps non-empty invalid quote errors as strategy failures", () => {
    const strategy = new FundingAwarePmmStrategy(new InvalidQuoteEngine() as never, config());

    const result = strategy.decide({
      snapshot: snapshot(),
      position: position(0),
      markoutFeedback: [],
      nowMs: 1,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().cause).toBeInstanceOf(InvalidQuoteError);
  });

  test("preserves markout quality gate behavior and reason tags", () => {
    const quoteEngine = new StubQuoteEngine();
    const strategy = new FundingAwarePmmStrategy(quoteEngine as never, {
      ...config(),
      markoutFeedbackGate: {
        enabled: true,
        minAverageMarkoutBps: 0,
        minSamples: 1,
        horizonsSec: [5],
      },
    });

    const result = strategy.decide({
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

    expect(result.isOk()).toBe(true);
    const decision = result._unsafeUnwrap();
    expect(
      StrategyDecision.match(decision, {
        quote: ({ reasonTags }) => reasonTags.includes("quality_gate:buy:5s_markout_below_0bps"),
        noQuote: () => false,
      }),
    ).toBe(true);
    expect(quoteEngine.computeCalls[0]?.sideSpecs.bid.disableIncreaseExposure).toBe(true);
  });
});

function config(): ConstructorParameters<typeof FundingAwarePmmStrategy>[1] {
  return {
    alpha: { enabled: true, source: "allora" },
    targetInventory: {
      maxQty: 0.35,
      alphaQtyPerBps: 0.025,
    },
    funding: {
      rateHorizonSec: 3600,
      holdingHorizonSec: 300,
    },
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
    marginRatio: null,
  };
}
