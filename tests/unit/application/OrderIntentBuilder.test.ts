import { describe, expect, test } from "bun:test";

import { OrderIntentBuilder } from "../../../src/application/services/OrderIntentBuilder";
import type { MarketSnapshot } from "../../../src/domain/ports/IMarketFeed";
import { MarketId } from "../../../src/domain/value-objects/MarketId";
import { Price } from "../../../src/domain/value-objects/Price";
import { Quantity } from "../../../src/domain/value-objects/Quantity";
import { Quote } from "../../../src/domain/value-objects/Quote";
import { QuoteLeg } from "../../../src/domain/value-objects/QuoteLeg";

describe("OrderIntentBuilder", () => {
  test("maps quote legs to venue-neutral order intents", () => {
    const builder = new OrderIntentBuilder();
    const result = builder.build({
      quote: quote(),
      quoteCycleId: "cycle-1",
      execution: { defaultTimeInForce: "ALO", postOnly: true },
      placement: { trendBps: 0, touchByLegKey: touchMap() },
    });

    expect(result.isOk()).toBe(true);
    const build = result._unsafeUnwrap();
    expect(build.intents.map((intent) => intent.orderSide)).toEqual(["buy", "sell"]);
    expect(build.intents.map((intent) => intent.reduceOnly)).toEqual([false, true]);
    expect(build.intents[0]?.clientOrderId).toBe("cycle-1:bid:0");
    expect(build.intents[1]?.clientOrderId).toBe("cycle-1:ask:0");
  });

  test("keeps reduce side while skipping stale increase side", () => {
    const builder = new OrderIntentBuilder({ nowMs: () => 1_000_000_010_000 });
    const staleTouch = snapshot({
      timestamp: 1_000_000_000_000,
      bookUpdatedAt: 1_000_000_000_000,
    });

    const result = builder.build({
      quote: quote(),
      quoteCycleId: "cycle-1",
      execution: { defaultTimeInForce: "GTC", postOnly: true },
      placement: {
        trendBps: 0,
        touchByLegKey: new Map([
          ["bid:0", staleTouch],
          ["ask:0", staleTouch],
        ]),
      },
    });

    const build = result._unsafeUnwrap();
    expect(build.intents.map((intent) => intent.orderSide)).toEqual(["sell"]);
    expect(build.skipped.map((skip) => skip.reason)).toEqual(["stale_touch"]);
  });

  test("clamps ALO prices to passive touch", () => {
    const builder = new OrderIntentBuilder();
    const result = builder.build({
      quote: quote({ bid: 100, ask: 100.5 }),
      quoteCycleId: "cycle-1",
      execution: { defaultTimeInForce: "ALO", postOnly: true },
      placement: { trendBps: 0, touchByLegKey: touchMap() },
    });

    const build = result._unsafeUnwrap();
    expect(Number(build.intents[0]?.price)).toBe(99);
    expect(Number(build.intents[1]?.price)).toBe(101);
  });

  test("keeps GTC quotes passive with the normal touch margin", () => {
    const builder = new OrderIntentBuilder();
    const result = builder.build({
      quote: quote({ bid: 100, ask: 100.5 }),
      quoteCycleId: "cycle-1",
      execution: { defaultTimeInForce: "GTC", postOnly: true },
      placement: { trendBps: 0, touchByLegKey: touchMap() },
    });

    const build = result._unsafeUnwrap();
    expect(Number(build.intents[0]?.price)).toBeCloseTo(98.997525);
    expect(Number(build.intents[1]?.price)).toBeCloseTo(101.000505);
  });

  test("widens GTC open quotes in adverse momentum while preserving reduce side margin", () => {
    const builder = new OrderIntentBuilder();
    const result = builder.build({
      quote: quote({ bid: 100, ask: 100.5 }),
      quoteCycleId: "cycle-1",
      execution: { defaultTimeInForce: "GTC", postOnly: true },
      placement: { trendBps: -1, touchByLegKey: touchMap() },
    });

    const build = result._unsafeUnwrap();
    expect(Number(build.intents[0]?.price)).toBeCloseTo(98.987525);
    expect(Number(build.intents[1]?.price)).toBeCloseTo(101.000505);
  });
});

function quote(input: { bid?: number; ask?: number } = {}) {
  return Quote.create({
    market: MarketId.unsafe("BTC-USD"),
    bids: [
      QuoteLeg.unsafe({
        side: "bid",
        price: Price.unsafe(input.bid ?? 98),
        size: Quantity.unsafe(1),
        level: 0,
        exposureIntent: "increase_exposure",
      }),
    ],
    asks: [
      QuoteLeg.unsafe({
        side: "ask",
        price: Price.unsafe(input.ask ?? 102),
        size: Quantity.unsafe(1),
        level: 0,
        exposureIntent: "reduce_exposure",
      }),
    ],
    referencePrice: Price.unsafe(100),
    fairPrice: Price.unsafe(100),
    sigma: 0.01,
    diagnostics: { quoteModel: "test", reasonTags: [] },
  })._unsafeUnwrap();
}

function touchMap() {
  const touch = snapshot();
  return new Map([
    ["bid:0", touch],
    ["ask:0", touch],
  ]);
}

function snapshot(input: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    market: "BTC-USD",
    bestBid: 99,
    bestAsk: 101,
    microPrice: 100,
    markPrice: 100,
    timestamp: 1,
    bookUpdatedAt: Date.now(),
    marginRatio: null,
    ...input,
  };
}
