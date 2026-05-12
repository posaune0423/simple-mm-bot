import { describe, expect, test } from "bun:test";
import { ok } from "neverthrow";

import { SimplePmmStrategy } from "../../../src/domain/strategies/SimplePmmStrategy.ts";
import { StrategyDecision } from "../../../src/domain/value-objects/StrategyDecision.ts";
import { MarketId } from "../../../src/domain/value-objects/MarketId.ts";
import { PositionSnapshot } from "../../../src/domain/value-objects/PositionSnapshot.ts";
import { Price } from "../../../src/domain/value-objects/Price.ts";
import { Quantity } from "../../../src/domain/value-objects/Quantity.ts";
import { Quote } from "../../../src/domain/value-objects/Quote.ts";
import { QuoteLeg } from "../../../src/domain/value-objects/QuoteLeg.ts";
import type { QuoteEngineInput } from "../../../src/domain/value-objects/QuoteEngineInput.ts";

class StubQuoteEngine {
  computeCalls: QuoteEngineInput[] = [];

  compute(input: QuoteEngineInput) {
    this.computeCalls.push(input);
    return ok(
      Quote.create({
        market: MarketId.unsafe("BTC-USD"),
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
});

function position(signedQuantity: number) {
  return PositionSnapshot.unsafe({
    market: MarketId.unsafe("BTC-USD"),
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
