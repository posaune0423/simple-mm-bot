import { describe, expect, test } from "bun:test";

import { QuoteEngine } from "../../src/domain/QuoteEngine.ts";
import { FairPriceCalculator } from "../../src/domain/FairPriceCalculator.ts";
import { VolatilityEstimator } from "../../src/domain/VolatilityEstimator.ts";
import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";
import { RefreshQuotesUseCase } from "../../src/application/usecases/RefreshQuotesUseCase.ts";
import { logger } from "../../src/utils/logger.ts";

function captureInfoLogs() {
  const info = logger.info;
  const messages: string[] = [];
  logger.info = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  return {
    messages,
    restore() {
      logger.info = info;
    },
  };
}

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
      new AvellanedaStoikovStrategy({ gamma: 0.02, kappa: 1.5, kInv: 0.3 }),
      new FairPriceCalculator(0.6),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.05,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
        defaultTimeInForce: "ALO",
        positionSize: 0.01,
        budgetUsd: 100,
      },
    );

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(calls[0]).toBe("cancelAll");
    expect(calls.slice(1)).toEqual(["place", "place"]);
  });

  test("logs quote creation and submitted order ids", async () => {
    const logs = captureInfoLogs();
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
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
      async place(order: { side: "buy" | "sell" }) {
        return {
          id: `${order.side}-1`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: 100,
            qty: 0.01,
            reduceOnly: false,
            timeInForce: "GTC" as const,
          },
          status: "open" as const,
        };
      },
      async cancel() {},
      async cancelAll() {},
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
      new AvellanedaStoikovStrategy({ gamma: 0, kappa: 8, kInv: 0.05 }),
      new FairPriceCalculator(0.5),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.5,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
        defaultTimeInForce: "GTC",
        positionSize: 0.05,
        budgetUsd: 250,
      },
    );

    try {
      await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

      expect(
        logs.messages.some((message) =>
          message.startsWith("refresh_quotes.quote_created market=BTC-USD"),
        ),
      ).toBe(true);
      expect(logs.messages).toContain(
        "refresh_quotes.orders_submitted market=BTC-USD bidOrderId=buy-1 bidStatus=open askOrderId=sell-1 askStatus=open",
      );
    } finally {
      logs.restore();
    }
  });
});
