import { describe, expect, test } from "bun:test";

import { ReduceInventoryUseCase } from "../../src/application/usecases/ReduceInventoryUseCase.ts";
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

describe("ReduceInventoryUseCase", () => {
  test("uses an aggressive IOC limit price when reducing long inventory", async () => {
    const placed: OrderRequest[] = [];

    const didReduce = await new ReduceInventoryUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "reduce-1", request: order, status: "open" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: 0.8, avgEntry: 100, unrealizedPnl: 0 };
        },
        async update() {
          throw new Error("unused");
        },
        async set() {},
      },
      {
        async connect() {},
        async disconnect() {},
        async getSnapshot() {
          return {
            market: "ETH-USD",
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
      },
      0.5,
      "ETH-USD",
      { reduceTriggerQty: 0.5, reduceTargetQty: 0.2 },
    ).executeIfNeeded();

    expect(didReduce).toBe(true);
    expect(placed).toEqual([
      expect.objectContaining({
        market: "ETH-USD",
        side: "sell",
        price: 99,
        qty: 0.6000000000000001,
        reduceOnly: true,
        timeInForce: "IOC",
        intent: "reduce",
      }),
    ]);
    expect(typeof placed[0]?.clientOrderId).toBe("string");
  });

  test("uses an aggressive IOC limit price when reducing short inventory", async () => {
    const placed: OrderRequest[] = [];

    await new ReduceInventoryUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "reduce-1", request: order, status: "open" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: -0.8, avgEntry: 100, unrealizedPnl: 0 };
        },
        async update() {
          throw new Error("unused");
        },
        async set() {},
      },
      {
        async connect() {},
        async disconnect() {},
        async getSnapshot() {
          return {
            market: "ETH-USD",
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
      },
      0.5,
      "ETH-USD",
      { reduceTriggerQty: 0.5, reduceTargetQty: 0.2 },
    ).executeIfNeeded();

    expect(placed[0]?.price).toBe(101);
  });

  test("logs reduce-only inventory order submission", async () => {
    const logs = captureInfoLogs();
    try {
      await new ReduceInventoryUseCase(
        {
          async place(order) {
            return { id: "reduce-1", request: order, status: "open" };
          },
          async cancel() {},
          async cancelAll() {},
          subscribeFills() {
            return () => {};
          },
        },
        {
          async get() {
            return { qty: 0.8, avgEntry: 100, unrealizedPnl: 0 };
          },
          async update() {
            throw new Error("unused");
          },
          async set() {},
        },
        {
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
        },
        0.5,
        "BTC-USD",
        { reduceTriggerQty: 0.5, reduceTargetQty: 0.2 },
      ).executeIfNeeded();

      expect(logs.messages).toContain(
        "reduce_inventory.order_submitted market=BTC-USD side=sell qty=0.6000000000000001 price=99 reduceTriggerQty=0.5 reduceTargetQty=0.2 maxPositionQty=0.5",
      );
    } finally {
      logs.restore();
    }
  });

  test("does not reduce until position exceeds the reduce trigger", async () => {
    const placed: OrderRequest[] = [];

    const didReduce = await new ReduceInventoryUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "reduce-1", request: order, status: "open" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: 0.08, avgEntry: 100, unrealizedPnl: 0 };
        },
        async update() {
          throw new Error("unused");
        },
        async set() {},
      },
      {
        async connect() {},
        async disconnect() {},
        async getSnapshot() {
          throw new Error("unused");
        },
        subscribe() {
          return () => {};
        },
      },
      0.22,
      "BTC-USD",
      { reduceTriggerQty: 0.08, reduceTargetQty: 0.04 },
    ).executeIfNeeded();

    expect(didReduce).toBe(false);
    expect(placed).toEqual([]);
  });

  test("cancels open orders before reducing positions beyond the hard max", async () => {
    const calls: string[] = [];

    await new ReduceInventoryUseCase(
      {
        async place() {
          calls.push("place");
          return {
            id: "reduce-1",
            request: {
              market: "BTC-USD",
              side: "buy",
              qty: 0.26,
              reduceOnly: true,
              timeInForce: "IOC",
            },
            status: "open",
          };
        },
        async cancel() {},
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: -0.3, avgEntry: 100_100, unrealizedPnl: 0 };
        },
        async update() {
          throw new Error("unused");
        },
        async set() {},
      },
      {
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
      },
      0.22,
      "BTC-USD",
      { reduceTriggerQty: 0.08, reduceTargetQty: 0.04 },
    ).executeIfNeeded();

    expect(calls).toEqual(["cancelAll", "place"]);
  });

  test("reduces before the trigger when unrealized loss exceeds the safety stop", async () => {
    const placed: OrderRequest[] = [];

    await new ReduceInventoryUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "reduce-1", request: order, status: "open" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: 0.06, avgEntry: 100_000, unrealizedPnl: -26 };
        },
        async update() {
          throw new Error("unused");
        },
        async set() {},
      },
      {
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
      },
      0.22,
      "BTC-USD",
      {
        reduceTriggerQty: 0.08,
        reduceTargetQty: 0.04,
        maxUnrealizedLossUsd: 25,
      },
    ).executeIfNeeded();

    expect(placed[0]).toMatchObject({
      side: "sell",
      qty: 0.019999999999999997,
      reduceOnly: true,
      intent: "reduce",
    });
  });

  test("reduces before the trigger when adverse move exceeds the safety stop", async () => {
    const placed: OrderRequest[] = [];

    await new ReduceInventoryUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "reduce-1", request: order, status: "open" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: -0.06, avgEntry: 100_000, unrealizedPnl: -10 };
        },
        async update() {
          throw new Error("unused");
        },
        async set() {},
      },
      {
        async connect() {},
        async disconnect() {},
        async getSnapshot() {
          return {
            market: "BTC-USD",
            bestBid: 100_290,
            bestAsk: 100_310,
            microPrice: 100_300,
            markPrice: 100_300,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      0.22,
      "BTC-USD",
      {
        reduceTriggerQty: 0.08,
        reduceTargetQty: 0.04,
        maxAdverseMoveBps: 20,
      },
    ).executeIfNeeded();

    expect(placed[0]).toMatchObject({
      side: "buy",
      qty: 0.019999999999999997,
      reduceOnly: true,
      intent: "reduce",
    });
  });
});
