import { describe, expect, test } from "bun:test";

import { QuoteEngine } from "../../src/domain/QuoteEngine.ts";
import { FairPriceCalculator } from "../../src/domain/FairPriceCalculator.ts";
import { VolatilityEstimator } from "../../src/domain/VolatilityEstimator.ts";
import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";
import { RefreshQuotesUseCase } from "../../src/application/usecases/RefreshQuotesUseCase.ts";
import type { MetricsRecorder } from "../../src/application/MetricsRecorder.ts";
import type { OrderRequest } from "../../src/domain/ports/IOrderGateway.ts";
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

function captureWarnLogs() {
  const warn = logger.warn;
  const messages: string[] = [];
  logger.warn = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  return {
    messages,
    restore() {
      logger.warn = warn;
    },
  };
}

describe("RefreshQuotesUseCase", () => {
  test("passes quality-gate controls into quote computation before placing orders", async () => {
    let receivedControls: unknown;
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99_990,
          bestAsk: 100_010,
          microPrice: 100_000,
          markPrice: 100_000,
          timestamp: Date.now(),
          marginRatio: 1,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: OrderRequest) {
        return { id: `${order.side}-1`, request: order, status: "open" as const };
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
    const quoteEngine = {
      compute(_snapshot: unknown, _position: unknown, controls: unknown) {
        receivedControls = controls;
        return {
          bid: 99_900,
          ask: 100_100,
          bidSize: 0,
          askSize: 0.01,
          bidIntent: "disabled" as const,
          askIntent: "open_quote" as const,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    };
    const qualityRepository = {
      async getRecentSideQuality() {
        return [
          {
            side: "buy" as const,
            horizons: [{ horizonSec: 30, sampleCount: 2, averageMarkoutBps: -1 }],
          },
        ];
      },
    };

    await new RefreshQuotesUseCase(
      marketFeed,
      orderGateway,
      positions,
      quoteEngine as never,
      undefined,
      qualityRepository,
      {
        enabled: true,
        minAverageMarkoutBps: 0,
        minSamples: 2,
        lookbackFills: 100,
        horizonsSec: [5, 30, 300],
      },
    ).execute();

    expect(receivedControls).toEqual({
      bid: {
        disableOpen: true,
        reasonTags: ["quality_gate:buy:30s_markout_below_0bps"],
      },
    });
  });

  test("places initial quotes without a blanket cancelAll", async () => {
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

    expect(calls).toEqual(["place", "place"]);
  });

  test("keeps existing quote orders when refreshed prices and sizes stay within thresholds", async () => {
    const calls: string[] = [];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99_990,
          bestAsk: 100_010,
          microPrice: 100_000,
          markPrice: 100_000,
          timestamp: 1,
          marginRatio: 0.2,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: OrderRequest) {
        calls.push(`place:${order.side}`);
        return {
          id: `${order.side}-1`,
          request: order,
          status: "open" as const,
        };
      },
      async cancel(id: string) {
        calls.push(`cancel:${id}`);
      },
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
    const quoteEngine = {
      compute() {
        return {
          bid: 99_970,
          ask: 100_030,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const useCase = new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine);

    await useCase.execute();
    await useCase.execute();

    expect(calls).toEqual(["place:buy", "place:sell"]);
  });

  test("does not fail the bot when every quote placement is rejected", async () => {
    const logs = captureWarnLogs();
    const placedStatuses = ["rejected", "rejected", "open", "open"] as const;
    const placed: string[] = [];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99_990,
          bestAsk: 100_010,
          microPrice: 100_000,
          markPrice: 100_000,
          timestamp: 1,
          marginRatio: 0.2,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: OrderRequest) {
        placed.push(order.side);
        return {
          id: `${order.side}-${placed.length}`,
          request: order,
          status: placedStatuses[placed.length - 1] ?? "open",
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
    const quoteEngine = {
      compute() {
        return {
          bid: 99_970,
          ask: 100_030,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const useCase = new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine);

    try {
      await useCase.execute();
      await useCase.execute();
    } finally {
      logs.restore();
    }

    expect(placed).toEqual(["buy", "sell", "buy", "sell"]);
    expect(logs.messages).toContain(
      "refresh_quotes.no_active_orders market=BTC-USD targetCount=2 rejectedOrSkipped=true",
    );
  });

  test("submits reduce-inventory quote sides as reduce-only reduce orders", async () => {
    const placed: OrderRequest[] = [];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99_990,
          bestAsk: 100_010,
          microPrice: 100_000,
          markPrice: 100_000,
          timestamp: 1,
          marginRatio: 0.2,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: OrderRequest) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: order,
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
        return { qty: -0.3, avgEntry: 100_100, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: -0.3, avgEntry: 100_100, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 99_970,
          ask: 100_030,
          bidSize: 0.3,
          askSize: 0.01,
          bidIntent: "reduce_inventory" as const,
          askIntent: "open_quote" as const,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed).toHaveLength(2);
    expect(placed[0]).toMatchObject({
      side: "buy",
      qty: 0.3,
      reduceOnly: true,
      intent: "reduce",
    });
    expect(placed[1]).toMatchObject({
      side: "sell",
      qty: 0.01,
      reduceOnly: false,
      intent: "quote",
    });
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

  test("places bid and ask with a shared quote cycle client order id prefix", async () => {
    const placed: Array<{ side: "buy" | "sell"; clientOrderId?: string }> = [];
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
      async place(order: { side: "buy" | "sell"; clientOrderId?: string }) {
        placed.push(order);
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

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed).toHaveLength(2);
    const bidPrefix = placed[0]?.clientOrderId?.replace(/:bid$/, "");
    const askPrefix = placed[1]?.clientOrderId?.replace(/:ask$/, "");
    expect(placed[0]?.clientOrderId?.endsWith(":bid")).toBe(true);
    expect(placed[1]?.clientOrderId?.endsWith(":ask")).toBe(true);
    expect(bidPrefix).toBe(askPrefix);
  });

  test("places every configured ladder level on both sides", async () => {
    const placed: Array<{
      side: "buy" | "sell";
      price?: number;
      qty: number;
      clientOrderId?: string;
    }> = [];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99_990,
          bestAsk: 100_010,
          microPrice: 100_000,
          markPrice: 100_000,
          timestamp: 1,
          marginRatio: 0.2,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: {
        side: "buy" | "sell";
        price?: number;
        qty: number;
        clientOrderId?: string;
      }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
            qty: order.qty,
            reduceOnly: false,
            timeInForce: "ALO" as const,
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
      new AvellanedaStoikovStrategy({ gamma: 0, kappa: 625, kInv: 0 }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.5,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
        defaultTimeInForce: "ALO",
        positionSize: 0.02,
        budgetUsd: 800,
        minSpreadBps: 16,
        levels: [
          { halfSpreadBps: 8, sizeUsd: 150 },
          { halfSpreadBps: 30, sizeUsd: 600 },
        ],
      },
    );

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed).toHaveLength(4);
    expect(placed.map((order) => order.side)).toEqual(["buy", "sell", "buy", "sell"]);
    expect(placed.map((order) => order.clientOrderId?.replace(/^[^:]+:/, ""))).toEqual([
      "bid:0",
      "ask:0",
      "bid:1",
      "ask:1",
    ]);
    expect(placed.map((order) => order.qty)).toEqual([0.0015, 0.0015, 0.006, 0.006]);
  });

  test("skips ladder sides with zero quote size", async () => {
    const placed: Array<{ side: "buy" | "sell"; qty: number; clientOrderId?: string }> = [];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99_990,
          bestAsk: 100_010,
          microPrice: 100_000,
          markPrice: 100_000,
          timestamp: 1,
          marginRatio: 0.2,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; qty: number; clientOrderId?: string }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            qty: order.qty,
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
        return { qty: 0.6, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0.6, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 99_970,
          ask: 100_030,
          bidSize: 0,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
          levels: [
            {
              level: 0,
              halfSpreadBps: 3,
              bid: 99_970,
              ask: 100_030,
              bidSize: 0,
              askSize: 0.01,
            },
          ],
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({
      side: "sell",
      qty: 0.01,
    });
    expect(placed[0]?.clientOrderId?.endsWith(":ask:0")).toBe(true);
  });

  test("submits ladder orders without waiting for earlier acknowledgements", async () => {
    const placed: Array<{ side: "buy" | "sell"; qty: number }> = [];
    const pending: Array<() => void> = [];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99_990,
          bestAsk: 100_010,
          microPrice: 100_000,
          markPrice: 100_000,
          timestamp: 1,
          marginRatio: 0.2,
        };
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; qty: number }) {
        placed.push(order);
        await new Promise<void>((resolve) => pending.push(resolve));
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            qty: order.qty,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 99_970,
          ask: 100_030,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
          levels: [
            {
              level: 0,
              halfSpreadBps: 3,
              bid: 99_970,
              ask: 100_030,
              bidSize: 0.01,
              askSize: 0.01,
            },
            {
              level: 1,
              halfSpreadBps: 4,
              bid: 99_960,
              ask: 100_040,
              bidSize: 0.02,
              askSize: 0.02,
            },
          ],
        };
      },
    } as unknown as QuoteEngine;

    const execution = new RefreshQuotesUseCase(
      marketFeed,
      orderGateway,
      positions,
      quoteEngine,
    ).execute();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell", "buy", "sell"]);

    for (const resolve of pending) {
      resolve();
    }
    await execution;
  });

  test("recomputes quotes from a fresh snapshot after canceling stale orders", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 89_990,
        bestAsk: 90_010,
        microPrice: 90_000,
        markPrice: 90_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 89_990,
        bestAsk: 90_010,
        microPrice: 90_000,
        markPrice: 90_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 89_990,
        bestAsk: 90_010,
        microPrice: 90_000,
        markPrice: 90_000,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 89_990,
        bestAsk: 90_010,
        microPrice: 90_000,
        markPrice: 90_000,
        timestamp: 5,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 90_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 90_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute(snapshot: { microPrice: number }) {
        return {
          bid: snapshot.microPrice - 10,
          ask: snapshot.microPrice + 10,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: snapshot.microPrice,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed[0]?.price).toBeCloseTo(89_987.75025);
    expect(placed[1]?.price).toBeCloseTo(90_012.25025);
  });

  test("keeps GTC quote orders behind the latest touch before submission", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_005,
        bestAsk: 100_015,
        microPrice: 100_010,
        markPrice: 100_010,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_005,
        bestAsk: 100_015,
        microPrice: 100_010,
        markPrice: 100_010,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_005,
        bestAsk: 100_015,
        microPrice: 100_010,
        markPrice: 100_010,
        timestamp: 5,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 100_006,
          ask: 100_014,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_010,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed[0]?.price).toBeCloseTo(100_002.499875);
    expect(placed[1]?.price).toBeCloseTo(100_017.500375);
  });

  test("refreshes the touch for each GTC side immediately before placing", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_980,
        bestAsk: 100_000,
        microPrice: 99_990,
        markPrice: 99_990,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_030,
        bestAsk: 100_050,
        microPrice: 100_040,
        markPrice: 100_040,
        timestamp: 5,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 99_995,
          ask: 100_025,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed[0]?.price).toBeCloseTo(99_977.5005);
    expect(placed[1]?.price).toBeCloseTo(100_052.50125);
  });

  test("records the guarded touch snapshots before submitting GTC quote orders", async () => {
    const calls: Array<
      | { action: "recordQuote" }
      | { action: "recordMarketSnapshot"; timestamp: number }
      | { action: "place"; side: "buy" | "sell"; price?: number }
    > = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_030,
        bestAsk: 100_050,
        microPrice: 100_040,
        markPrice: 100_040,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_060,
        bestAsk: 100_080,
        microPrice: 100_070,
        markPrice: 100_070,
        timestamp: 5,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        calls.push({ action: "place", side: order.side, price: order.price });
        return {
          id: `${order.side}-1`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 100_000,
          ask: 100_020,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_010,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const metrics = {
      async recordQuote() {
        calls.push({ action: "recordQuote" });
      },
      async recordMarketSnapshot(snapshot: { timestamp: number }) {
        calls.push({ action: "recordMarketSnapshot", timestamp: snapshot.timestamp });
      },
    };

    await new RefreshQuotesUseCase(
      marketFeed,
      orderGateway,
      positions,
      quoteEngine,
      metrics as unknown as MetricsRecorder,
    ).execute();

    expect(calls.map((call) => call.action)).toEqual([
      "recordQuote",
      "recordMarketSnapshot",
      "recordMarketSnapshot",
      "place",
      "place",
    ]);
    expect(calls[1]).toMatchObject({ timestamp: 4 });
    expect(calls[2]).toMatchObject({ timestamp: 5 });
    expect(calls[3]).toMatchObject({ side: "buy" });
    expect(calls[3]?.action === "place" ? calls[3].price : undefined).toBeCloseTo(100_000);
    expect(calls[4]).toMatchObject({ side: "sell" });
    expect(calls[4]?.action === "place" ? calls[4].price : undefined).toBeCloseTo(100_082.502);
  });

  test("keeps both open quote sides during ordinary short-term drift", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 5,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_995,
        bestAsk: 100_015,
        microPrice: 100_005,
        markPrice: 100_005,
        timestamp: 6,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_995,
        bestAsk: 100_015,
        microPrice: 100_005,
        markPrice: 100_005,
        timestamp: 7,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_995,
        bestAsk: 100_015,
        microPrice: 100_005,
        markPrice: 100_005,
        timestamp: 8,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_995,
        bestAsk: 100_015,
        microPrice: 100_005,
        markPrice: 100_005,
        timestamp: 9,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_995,
        bestAsk: 100_015,
        microPrice: 100_005,
        markPrice: 100_005,
        timestamp: 10,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute(snapshot: { microPrice: number }) {
        return {
          bid: snapshot.microPrice - 20,
          ask: snapshot.microPrice + 20,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: snapshot.microPrice,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const useCase = new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine);

    await useCase.execute();
    await useCase.execute();

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell", "buy", "sell"]);
    expect(placed[3]?.price).toBeCloseTo(100_030.00025);
  });

  test("skips open bids during a short-term down move", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 5,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 6,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 7,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 8,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 9,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 10,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute(snapshot: { microPrice: number }) {
        return {
          bid: snapshot.microPrice - 20,
          ask: snapshot.microPrice + 20,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: snapshot.microPrice,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const useCase = new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine);

    await useCase.execute();
    await useCase.execute();

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell", "sell"]);
  });

  test("skips reduce bids during a short-term down move", async () => {
    const placed: Array<{ side: "buy" | "sell"; reduceOnly?: boolean }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 5,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 6,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 7,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 8,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 9,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_940,
        bestAsk: 99_960,
        microPrice: 99_950,
        markPrice: 99_950,
        timestamp: 10,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; reduceOnly?: boolean }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            qty: 0.01,
            reduceOnly: order.reduceOnly ?? false,
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
        return { qty: -0.3, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: -0.3, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute(snapshot: { microPrice: number }) {
        return {
          bid: snapshot.microPrice - 20,
          ask: snapshot.microPrice + 20,
          bidSize: 0.01,
          askSize: 0.01,
          bidIntent: "reduce_inventory" as const,
          askIntent: "open_quote" as const,
          policy: "GTC" as const,
          fairPrice: snapshot.microPrice,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const useCase = new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine);

    await useCase.execute();
    await useCase.execute();

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell", "sell"]);
    expect(placed[0]?.reduceOnly).toBe(true);
  });

  test("skips reduce asks during a short-term up move", async () => {
    const placed: Array<{ side: "buy" | "sell"; reduceOnly?: boolean }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_050,
        bestAsk: 100_070,
        microPrice: 100_060,
        markPrice: 100_060,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_050,
        bestAsk: 100_070,
        microPrice: 100_060,
        markPrice: 100_060,
        timestamp: 5,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_050,
        bestAsk: 100_070,
        microPrice: 100_060,
        markPrice: 100_060,
        timestamp: 6,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_050,
        bestAsk: 100_070,
        microPrice: 100_060,
        markPrice: 100_060,
        timestamp: 7,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_050,
        bestAsk: 100_070,
        microPrice: 100_060,
        markPrice: 100_060,
        timestamp: 8,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_050,
        bestAsk: 100_070,
        microPrice: 100_060,
        markPrice: 100_060,
        timestamp: 9,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 100_050,
        bestAsk: 100_070,
        microPrice: 100_060,
        markPrice: 100_060,
        timestamp: 10,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; reduceOnly?: boolean }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            qty: 0.01,
            reduceOnly: order.reduceOnly ?? false,
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
        return { qty: 0.3, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0.3, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute(snapshot: { microPrice: number }) {
        return {
          bid: snapshot.microPrice - 20,
          ask: snapshot.microPrice + 20,
          bidSize: 0.01,
          askSize: 0.01,
          bidIntent: "open_quote" as const,
          askIntent: "reduce_inventory" as const,
          policy: "GTC" as const,
          fairPrice: snapshot.microPrice,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const useCase = new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine);

    await useCase.execute();
    await useCase.execute();

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell", "buy"]);
    expect(placed[1]?.reduceOnly).toBe(true);
  });

  test("skips open bids during a short-term down move while keeping the ask side live", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 2,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 3,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_900,
        bestAsk: 99_920,
        microPrice: 99_910,
        markPrice: 99_910,
        timestamp: 4,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_900,
        bestAsk: 99_920,
        microPrice: 99_910,
        markPrice: 99_910,
        timestamp: 5,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_900,
        bestAsk: 99_920,
        microPrice: 99_910,
        markPrice: 99_910,
        timestamp: 6,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_900,
        bestAsk: 99_920,
        microPrice: 99_910,
        markPrice: 99_910,
        timestamp: 7,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_900,
        bestAsk: 99_920,
        microPrice: 99_910,
        markPrice: 99_910,
        timestamp: 8,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_900,
        bestAsk: 99_920,
        microPrice: 99_910,
        markPrice: 99_910,
        timestamp: 9,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_900,
        bestAsk: 99_920,
        microPrice: 99_910,
        markPrice: 99_910,
        timestamp: 10,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute(snapshot: { microPrice: number }) {
        return {
          bid: snapshot.microPrice - 20,
          ask: snapshot.microPrice + 20,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: snapshot.microPrice,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;
    const useCase = new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine);

    await useCase.execute();
    await useCase.execute();

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell", "sell"]);
  });

  test("does not skip GTC quote placement for normal websocket lag", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const now = Date.now();
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now - 2_500,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now - 2_500,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 99_980,
          ask: 100_020,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell"]);
  });

  test("skips new GTC quote placement when the refreshed touch is stale", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const now = Date.now();
    const snapshots = [
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now - 3_500,
        marginRatio: 0.2,
      },
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: now - 3_500,
        marginRatio: 0.2,
      },
    ];
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 99_980,
          ask: 100_020,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed).toEqual([]);
  });

  test("does not treat historical candle snapshots as stale touch", async () => {
    const placed: Array<{ side: "buy" | "sell"; price?: number }> = [];
    const oldCandle = {
      market: "BTC-USD",
      bestBid: 99_990,
      bestAsk: 100_010,
      microPrice: 100_000,
      markPrice: 100_000,
      timestamp: Date.now() - 86_400_000,
      marginRatio: 0.2,
      open: 99_950,
      high: 100_050,
      low: 99_900,
      close: 100_000,
    };
    const snapshots = Array.from({ length: 5 }, () => ({ ...oldCandle }));
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        const snapshot = snapshots.shift();
        if (snapshot === undefined) {
          throw new Error("unexpected extra snapshot");
        }
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };
    const orderGateway = {
      async place(order: { side: "buy" | "sell"; price?: number }) {
        placed.push(order);
        return {
          id: `${order.side}-${placed.length}`,
          request: {
            market: "BTC-USD",
            side: order.side,
            price: order.price,
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
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async update() {
        return { qty: 0, avgEntry: 100_000, unrealizedPnl: 0 };
      },
      async set() {},
    };
    const quoteEngine = {
      compute() {
        return {
          bid: 99_980,
          ask: 100_020,
          bidSize: 0.01,
          askSize: 0.01,
          policy: "GTC" as const,
          fairPrice: 100_000,
          sigma: 0,
        };
      },
    } as unknown as QuoteEngine;

    await new RefreshQuotesUseCase(marketFeed, orderGateway, positions, quoteEngine).execute();

    expect(placed.map((order) => order.side)).toEqual(["buy", "sell"]);
  });
});
