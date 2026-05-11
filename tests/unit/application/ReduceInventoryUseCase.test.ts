import { describe, expect, test } from "bun:test";

import { ReduceInventoryUseCase } from "../../../src/application/usecases/ReduceInventoryUseCase.ts";
import type { OrderRequest } from "../../../src/domain/ports/IOrderGateway.ts";
import { logger } from "../../../src/utils/logger.ts";

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
  test("uses a reduce-only IOC market order when reducing long inventory", async () => {
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
    expect(placed).toMatchObject([
      {
        market: "ETH-USD",
        side: "sell",
        qty: 0.6000000000000001,
        reduceOnly: true,
        timeInForce: "IOC",
        intent: "reduce",
      },
    ]);
    expect(placed[0]?.price).toBeUndefined();
    expect(typeof placed[0]?.clientOrderId).toBe("string");
  });

  test("uses a reduce-only IOC market order when reducing short inventory", async () => {
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

    expect(placed[0]?.price).toBeUndefined();
  });

  test("falls back to an aggressive IOC limit when market reduce is rejected", async () => {
    const placed: OrderRequest[] = [];

    await new ReduceInventoryUseCase(
      {
        async place(order) {
          placed.push(order);
          return {
            id: `reduce-${placed.length}`,
            request: order,
            status: placed.length === 1 ? "rejected" : "open",
          };
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

    expect(placed).toMatchObject([{ side: "buy" }, { side: "buy", price: 101.505 }]);
    expect(placed[0]?.price).toBeUndefined();
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
        "[application] ReduceInventory | ORDER_SUBMITTED | market=BTC-USD side=sell qty=0.6000000000000001 price=market reduceTriggerQty=0.5 reduceTargetQty=0.2 maxPositionQty=0.5",
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

  test("cancels resting reduce quotes before hard reducing a position above the trigger", async () => {
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
              qty: 0.18,
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
          return { qty: -0.3, avgEntry: 100_000, unrealizedPnl: 0 };
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
      0.34,
      "BTC-USD",
      { reduceTriggerQty: 0.28, reduceTargetQty: 0.12 },
    ).executeIfNeeded();

    expect(calls).toEqual(["cancelAll", "place"]);
  });

  test("defers reducing a short position while price is moving favorably before the hard max", async () => {
    const calls: string[] = [];
    const positions = [
      { qty: -0.5, avgEntry: 100_000, unrealizedPnl: 0 },
      { qty: -0.6, avgEntry: 100_000, unrealizedPnl: 0 },
    ];
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
        bestBid: 99_970,
        bestAsk: 99_990,
        microPrice: 99_980,
        markPrice: 99_980,
        timestamp: 2,
        marginRatio: 0.2,
      },
    ];
    const useCase = new ReduceInventoryUseCase(
      {
        async place(order) {
          calls.push(`place:${order.side}`);
          return { id: "reduce-1", request: order, status: "open" };
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
          const position = positions.shift();
          if (position === undefined) {
            throw new Error("unexpected position read");
          }
          return position;
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
          const snapshot = snapshots.shift();
          if (snapshot === undefined) {
            throw new Error("unexpected snapshot read");
          }
          return snapshot;
        },
        subscribe() {
          return () => {};
        },
      },
      0.65,
      "BTC-USD",
      {
        reduceTriggerQty: 0.55,
        reduceTargetQty: 0.35,
        maxAdverseMoveBps: 70,
      },
    );

    expect(await useCase.executeIfNeeded()).toBe(false);
    expect(await useCase.executeIfNeeded()).toBe(false);
    expect(calls).toEqual([]);
  });

  test("does not defer favorable inventory reduction beyond the hard max", async () => {
    const calls: string[] = [];
    const positions = [
      { qty: -0.5, avgEntry: 100_000, unrealizedPnl: 0 },
      { qty: -0.7, avgEntry: 100_000, unrealizedPnl: 0 },
    ];
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
        bestBid: 99_970,
        bestAsk: 99_990,
        microPrice: 99_980,
        markPrice: 99_980,
        timestamp: 2,
        marginRatio: 0.2,
      },
    ];
    const useCase = new ReduceInventoryUseCase(
      {
        async place(order) {
          calls.push(`place:${order.side}`);
          return { id: "reduce-1", request: order, status: "open" };
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
          const position = positions.shift();
          if (position === undefined) {
            throw new Error("unexpected position read");
          }
          return position;
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
          const snapshot = snapshots.shift();
          if (snapshot === undefined) {
            throw new Error("unexpected snapshot read");
          }
          return snapshot;
        },
        subscribe() {
          return () => {};
        },
      },
      0.65,
      "BTC-USD",
      {
        reduceTriggerQty: 0.55,
        reduceTargetQty: 0.35,
        maxAdverseMoveBps: 70,
      },
    );

    expect(await useCase.executeIfNeeded()).toBe(false);
    expect(await useCase.executeIfNeeded()).toBe(true);
    expect(calls).toEqual(["cancelAll", "place:buy"]);
  });

  test("fails closed after consecutive hard reduce order rejections", async () => {
    const calls: string[] = [];
    const useCase = new ReduceInventoryUseCase(
      {
        async place() {
          calls.push("place");
          return {
            id: "reduce-rejected",
            request: {
              market: "BTC-USD",
              side: "buy",
              price: 100_010,
              qty: 0.26,
              reduceOnly: true,
              timeInForce: "IOC",
              intent: "reduce",
            },
            status: "rejected",
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
          return { qty: -0.3, avgEntry: 100_000, unrealizedPnl: -12 };
        },
        async update() {
          return { qty: -0.3, avgEntry: 100_000, unrealizedPnl: -12 };
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
    );

    expect(await useCase.executeIfNeeded()).toBe(true);
    expect(await useCase.executeIfNeeded()).toBe(true);
    const failure = await useCase.executeIfNeeded().catch((error) => error);
    expect(String(failure)).toContain(
      "Hard inventory reduce failed closed after 3 consecutive failures",
    );
    expect(calls).toEqual([
      "cancelAll",
      "place",
      "place",
      "cancelAll",
      "place",
      "place",
      "cancelAll",
      "place",
      "place",
    ]);
  });

  test("fails closed after consecutive hard reduce submission timeouts", async () => {
    const useCase = new ReduceInventoryUseCase(
      {
        async place() {
          const error = new Error("HTTP request timed out: POST /trade");
          (error as { status?: number }).status = 408;
          throw error;
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: 0.3, avgEntry: 100_000, unrealizedPnl: -12 };
        },
        async update() {
          return { qty: 0.3, avgEntry: 100_000, unrealizedPnl: -12 };
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
    );

    expect(await useCase.executeIfNeeded()).toBe(true);
    expect(await useCase.executeIfNeeded()).toBe(true);
    const failure = await useCase.executeIfNeeded().catch((error) => error);
    expect(String(failure)).toContain(
      "Hard inventory reduce failed closed after 3 consecutive failures",
    );
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
