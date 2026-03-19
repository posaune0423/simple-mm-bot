import { describe, expect, test } from "bun:test";

import { QuoteEngine } from "../../src/domain/QuoteEngine.ts";
import { FairPriceCalculator } from "../../src/domain/FairPriceCalculator.ts";
import { VolatilityEstimator } from "../../src/domain/VolatilityEstimator.ts";
import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";
import { RefreshQuotesUseCase } from "../../src/application/usecases/RefreshQuotesUseCase.ts";

describe("RefreshQuotesUseCase", () => {
  test("cancels existing orders before placing new quotes", async () => {
    const calls: string[] = [];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "ETH",
          bestBid: 99,
          bestAsk: 101,
          microPrice: 100,
          markPrice: 100,
          timestamp: 1,
          marginRatio: 0.2,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place() {
        calls.push("place");
        return {
          id: "1",
          request: {
            market: "ETH",
            side: "buy" as const,
            price: 100,
            qty: 0.01,
            reduceOnly: false,
            timeInForce: "ALO" as const,
          },
          status: "open" as const,
        };
      },
      async cancel() {},
      async cancelAll() {
        calls.push("cancelAll");
      },
      subscribeFills() {
        return () => {};
      },
    };
    const positions = {
      async get() {
        return { qty: 0, avgEntry: 0, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 0, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = new QuoteEngine(
      new AvellanedaStoikovStrategy({ gamma: 0.02, kappa: 1.5, kInv: 0.3, baseSize: 0.01 }),
      new FairPriceCalculator(0.6),
      new VolatilityEstimator(),
      { inventoryScale: 0.05, timeHorizonSec: 30, slideMarginThreshold: 0.12 },
    );

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(calls[0]).toBe("cancelAll");
    expect(calls.slice(1)).toEqual(["place", "place"]);
  });
});
