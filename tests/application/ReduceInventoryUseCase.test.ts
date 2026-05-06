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
    ).executeIfNeeded();

    expect(didReduce).toBe(true);
    expect(placed).toEqual([
      expect.objectContaining({
        market: "ETH-USD",
        side: "sell",
        price: 99,
        qty: 0.30000000000000004,
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
      ).executeIfNeeded();

      expect(logs.messages).toContain(
        "reduce_inventory.order_submitted market=BTC-USD side=sell qty=0.30000000000000004 price=99 maxPositionQty=0.5",
      );
    } finally {
      logs.restore();
    }
  });
});
