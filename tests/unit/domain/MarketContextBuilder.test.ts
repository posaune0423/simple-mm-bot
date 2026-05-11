import { describe, expect, test } from "bun:test";

import { MarketContextBuilder } from "../../../src/domain/MarketContextBuilder.ts";

describe("MarketContextBuilder", () => {
  test("derives component ages, local spread, and external diff", () => {
    const context = new MarketContextBuilder().build({
      snapshot: {
        market: "BTC-USD",
        bestBid: 99,
        bestAsk: 101,
        microPrice: 100,
        markPrice: 100,
        timestamp: 1_700_000_000_000,
        bookUpdatedAt: 1_700_000_000_900,
        tickerUpdatedAt: 1_700_000_000_800,
        accountUpdatedAt: 1_700_000_000_500,
        positionUpdatedAt: 1_700_000_000_400,
        positionQty: -0.1,
        marginRatio: 0.2,
      },
      now: 1_700_000_001_000,
      positionQty: 0.25,
      externalMid: 100.1,
      externalUpdatedAt: 1_700_000_000_750,
    });

    expect(context.midPrice).toBe(100);
    expect(context.bookAgeMs).toBe(100);
    expect(context.tickerAgeMs).toBe(200);
    expect(context.accountAgeMs).toBe(500);
    expect(context.positionAgeMs).toBe(600);
    expect(context.externalAgeMs).toBe(250);
    expect(context.localSpreadBps).toBeCloseTo(202.0202);
    expect(context.positionQty).toBe(0.25);
    expect(context.externalDiffBps).toBeCloseTo(10);
  });

  test("uses snapshot position quantity when explicit position is omitted", () => {
    const context = new MarketContextBuilder().build({
      snapshot: {
        market: "BTC-USD",
        bestBid: 99,
        bestAsk: 101,
        microPrice: 100,
        markPrice: 100,
        timestamp: 1_700_000_000_000,
        positionQty: -0.1,
        marginRatio: 0.2,
      },
      now: 1_700_000_001_000,
    });

    expect(context.positionQty).toBe(-0.1);
  });
});
