import { describe, expect, test } from "bun:test";

import { ClosePositionUseCase } from "../../../src/application/usecases/ClosePositionUseCase.ts";
import type { OrderRequest } from "../../../src/domain/ports/IOrderGateway.ts";

describe("ClosePositionUseCase", () => {
  test("does not submit a close order for floating-point residual inventory", async () => {
    const placed: OrderRequest[] = [];

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          throw new Error("floating-point residual should not be closed");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: 1.3877787807814457e-17, avgEntry: 100, unrealizedPnl: 0 };
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
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(placed).toEqual([]);
  });

  test("uses a market reduce-only order first to close long inventory", async () => {
    const placed: OrderRequest[] = [];
    let syncFillsCount = 0;

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "close-1", request: order, status: "filled" };
        },
        async cancel() {},
        async cancelAll() {},
        async syncFills() {
          syncFillsCount += 1;
        },
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: 0.4, avgEntry: 100, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(placed).toEqual([
      expect.objectContaining({
        market: "BTC-USD",
        side: "sell",
        qty: 0.4,
        reduceOnly: true,
        timeInForce: "IOC",
        intent: "close",
      }),
    ]);
    expect(placed[0]?.price).toBeUndefined();
    expect(typeof placed[0]?.clientOrderId).toBe("string");
    expect(syncFillsCount).toBe(4);
  });

  test("polls fills more than once after a close fill because Bulk fill indexing is delayed", async () => {
    const syncCalls: number[] = [];

    await new ClosePositionUseCase(
      {
        async place(order) {
          return { id: "close-delayed", request: order, status: "filled" };
        },
        async cancel() {},
        async cancelAll() {},
        async syncFills() {
          syncCalls.push(Date.now());
        },
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: -0.003, avgEntry: 81500, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(syncCalls).toHaveLength(4);
  });

  test("retries market close orders until one fills", async () => {
    const placed: OrderRequest[] = [];

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          return {
            id: `close-${placed.length}`,
            request: order,
            status: placed.length === 1 ? "cancelled" : "filled",
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
          return { qty: -0.4, avgEntry: 100, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(placed).toHaveLength(2);
    expect(placed[0]?.price).toBeUndefined();
    expect(placed[1]?.price).toBeUndefined();
    expect(placed.every((order) => order.reduceOnly === true)).toBe(true);
    expect(placed.every((order) => order.timeInForce === "IOC")).toBe(true);
  });

  test("falls back to an accepted IOC limit band when Bulk rejects market close as price-less", async () => {
    const placed: OrderRequest[] = [];

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          if (placed.length === 1) {
            throw new Error("order.price is required");
          }
          return { id: "close-2", request: order, status: "filled" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: -0.4, avgEntry: 100, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(placed).toHaveLength(2);
    expect(placed[0]?.price).toBeUndefined();
    expect(placed[1]?.price).toBe(81731.87625);
  });

  test("continues shutdown close after a partial IOC fill until inventory is flat", async () => {
    const placed: OrderRequest[] = [];
    let positionQty = -0.4;

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          if (placed.length === 1) {
            positionQty = -0.1;
            return { id: "close-partial", request: order, status: "partially_filled" };
          }
          positionQty = 0;
          return { id: "close-final", request: order, status: "filled" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: positionQty, avgEntry: 100, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(placed).toHaveLength(2);
    expect(placed[0]?.qty).toBe(0.4);
    expect(placed[1]?.qty).toBe(0.1);
  });

  test("refreshes live venue position between shutdown close attempts", async () => {
    const placed: OrderRequest[] = [];
    const liveQty = [0.4, 0.02, 0];
    let liveReads = 0;
    let syncCount = 0;

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          return {
            id: `close-${placed.length}`,
            request: order,
            status: placed.length === 1 ? "partially_filled" : "cancelled",
          };
        },
        async cancel() {},
        async cancelAll() {},
        async syncFills() {
          syncCount += 1;
        },
        async getPosition() {
          const qty = liveQty[Math.min(liveReads, liveQty.length - 1)] ?? 0;
          liveReads += 1;
          return { qty, avgEntry: 100, unrealizedPnl: 0 };
        },
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: 0.4, avgEntry: 100, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(syncCount).toBe(3);
    expect(placed).toHaveLength(2);
    expect(placed[0]?.qty).toBe(0.4);
    expect(placed[1]?.qty).toBe(0.02);
  });

  test("fails when every shutdown close retry is not filled", async () => {
    const placed: OrderRequest[] = [];

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "close-1", request: order, status: "cancelled" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: -0.4, avgEntry: 100, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    )
      .execute()
      .then(
        () => {
          throw new Error("Expected close order failure");
        },
        (error) => {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe(
            "Close position order did not fill after 30 attempts: market=BTC-USD side=buy qty=0.4 status=cancelled",
          );
          expect(placed).toHaveLength(30);
        },
      );
  });

  test("uses a market reduce-only order first to close short inventory", async () => {
    const placed: OrderRequest[] = [];

    await new ClosePositionUseCase(
      {
        async place(order) {
          placed.push(order);
          return { id: "close-1", request: order, status: "filled" };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      {
        async get() {
          return { qty: -0.4, avgEntry: 100, unrealizedPnl: 0 };
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
            bestBid: 81324.75,
            bestAsk: 81325.25,
            microPrice: 81325,
            markPrice: 81325,
            timestamp: 1,
            marginRatio: 0.2,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      "BTC-USD",
      [0, 0, 0],
      0,
    ).execute();

    expect(placed[0]?.price).toBeUndefined();
  });
});
