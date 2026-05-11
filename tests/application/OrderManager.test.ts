import { describe, expect, test } from "bun:test";

import { OrderManager, type ManagedOrderRequest } from "../../src/application/OrderManager.ts";
import type { IOrderGateway, PlacedOrder } from "../../src/domain/ports/IOrderGateway.ts";

async function expectUnknownStateError(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(String(error)).toContain("cancel_failed_unknown_order_state");
    return;
  }
  throw new Error("Expected reconcile to reject with unknown order state");
}

function quoteOrder(overrides: Partial<ManagedOrderRequest> = {}): ManagedOrderRequest {
  return {
    key: "bid",
    market: "BTC-USD",
    side: "buy",
    price: 100,
    qty: 1,
    reduceOnly: false,
    timeInForce: "GTC",
    clientOrderId: "quote-1",
    intent: "quote",
    ...overrides,
  };
}

describe("OrderManager", () => {
  test("places replacement orders only after the previous order cancellation completes", async () => {
    let cancelFinished = false;
    let releaseCancel: (() => void) | undefined;
    let secondPlaceSawFinishedCancel: boolean | undefined;

    const gateway: IOrderGateway = {
      async place(order) {
        if (order.clientOrderId === "quote-2") {
          secondPlaceSawFinishedCancel = cancelFinished;
        }
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel() {
        await new Promise<void>((resolve) => {
          releaseCancel = () => {
            cancelFinished = true;
            resolve();
          };
        });
      },
      async cancelAll() {},
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);
    await manager.reconcile([quoteOrder()]);

    const reconcile = manager.reconcile([quoteOrder({ price: 101, clientOrderId: "quote-2" })]);
    await Promise.resolve();

    expect(secondPlaceSawFinishedCancel).toBeUndefined();
    releaseCancel?.();
    await reconcile;
    expect(secondPlaceSawFinishedCancel).toBe(true);
  });

  test("does not retain rejected quote placements as active orders", async () => {
    let placeCount = 0;
    const gateway: IOrderGateway = {
      async place(order) {
        placeCount += 1;
        return {
          id: order.clientOrderId ?? `order-${placeCount}`,
          request: order,
          status: "rejected",
        } satisfies PlacedOrder;
      },
      async cancel() {},
      async cancelAll() {},
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);
    const firstActive = await manager.reconcile([quoteOrder()]);
    const secondActive = await manager.reconcile([quoteOrder()]);

    expect(firstActive).toHaveLength(0);
    expect(secondActive).toHaveLength(0);
    expect(placeCount).toBe(2);
  });

  test("skips a failed quote placement while waiting for other placements", async () => {
    const calls: string[] = [];
    const gateway: IOrderGateway = {
      async place(order) {
        calls.push(`place:${order.clientOrderId}`);
        if (order.clientOrderId === "bad") {
          throw new Error("Bulk BTC-USD order notional is below minimum");
        }
        await Bun.sleep(1);
        calls.push(`placed:${order.clientOrderId}`);
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel() {},
      async cancelAll() {},
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);
    const active = await manager.reconcile([
      quoteOrder({ key: "bad", clientOrderId: "bad", qty: 0.000001 }),
      quoteOrder({ key: "good", clientOrderId: "good", side: "sell", price: 101 }),
    ]);

    expect(active.map((entry) => entry.key)).toEqual(["good"]);
    expect(calls).toEqual(["place:bad", "place:good", "placed:good"]);
  });

  test("delays new quote placements after tracked exchange orders disappear", async () => {
    const calls: string[] = [];
    let nowMs = 1_000;
    const gateway: IOrderGateway = {
      async place(order) {
        calls.push(`place:${order.clientOrderId}`);
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel(id: string) {
        calls.push(`cancel:${id}`);
      },
      async cancelAll() {},
      async getOpenOrders() {
        return [];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway, {
      exchangeDropQuoteCooldownMs: 1_500,
      nowMs: () => nowMs,
    });
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-1" })]);
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-2" })]);
    nowMs = 2_501;
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-3" })]);

    expect(calls).toEqual(["place:quote-1", "place:quote-3"]);
  });

  test("exposes tracked order and quote cooldown state for runtime diagnostics", async () => {
    let nowMs = 1_000;
    const gateway: IOrderGateway = {
      async place(order) {
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel() {},
      async cancelAll() {},
      async getOpenOrders() {
        return [];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway, {
      exchangeDropQuoteCooldownMs: 1_500,
      nowMs: () => nowMs,
    });
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-1" })]);
    expect(manager.state()).toEqual(
      expect.objectContaining({
        trackedOrderCount: 1,
        quoteCooldownUntilMs: 0,
        quoteCooldownRemainingMs: 0,
      }),
    );

    await manager.reconcile([quoteOrder({ clientOrderId: "quote-2" })]);
    expect(manager.state()).toEqual(
      expect.objectContaining({
        trackedOrderCount: 0,
        quoteCooldownUntilMs: 2_500,
        quoteCooldownRemainingMs: 1_500,
      }),
    );

    nowMs = 2_501;
    expect(manager.state()).toEqual(
      expect.objectContaining({
        quoteCooldownUntilMs: 2_500,
        quoteCooldownRemainingMs: 0,
      }),
    );
  });

  test("does not delay reduce placements after tracked exchange orders disappear", async () => {
    const calls: string[] = [];
    const gateway: IOrderGateway = {
      async place(order) {
        calls.push(`place:${order.clientOrderId}`);
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel(id: string) {
        calls.push(`cancel:${id}`);
      },
      async cancelAll() {},
      async getOpenOrders() {
        return [];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-1" })]);
    await manager.reconcile([
      quoteOrder({
        clientOrderId: "reduce-1",
        intent: "reduce",
        side: "sell",
        reduceOnly: true,
      }),
    ]);

    expect(calls).toEqual(["place:quote-1", "place:reduce-1"]);
  });

  test("cancels exchange open orders that are not tracked locally", async () => {
    const calls: string[] = [];
    let syncCount = 0;
    const gateway: IOrderGateway = {
      async place(order) {
        calls.push(`place:${order.clientOrderId}`);
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel(id: string) {
        calls.push(`cancel:${id}`);
      },
      async cancelAll() {},
      async getOpenOrders() {
        syncCount += 1;
        if (syncCount === 1) {
          return [];
        }
        return [
          {
            id: "quote-1",
            market: "BTC-USD",
            side: "buy",
            price: 100,
            qty: 1,
            reduceOnly: false,
            timeInForce: "GTC",
            status: "open",
          },
          {
            id: "orphan",
            market: "BTC-USD",
            side: "sell",
            price: 101,
            qty: 1,
            reduceOnly: false,
            timeInForce: "GTC",
            status: "open",
          },
        ];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-1" })]);
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-2" })]);

    expect(calls).toEqual(["place:quote-1", "cancel:orphan"]);
  });

  test("marks tracked orders unknown and cancels all when cancel fails", async () => {
    const calls: string[] = [];
    const gateway: IOrderGateway = {
      async place(order) {
        calls.push(`place:${order.clientOrderId}`);
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel(id: string) {
        calls.push(`cancel:${id}`);
        throw new Error("cancel failed");
      },
      async cancelAll() {
        calls.push("cancelAll");
      },
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);
    await manager.reconcile([quoteOrder({ clientOrderId: "quote-1" })]);

    await expectUnknownStateError(manager.reconcile([]));
    expect(manager.state()).toEqual(
      expect.objectContaining({
        unknownOrderState: true,
        cancelFailures: 1,
        unknownOrderKeys: ["bid"],
      }),
    );
    expect(calls).toEqual(["place:quote-1", "cancel:quote-1", "cancelAll"]);
  });

  test("marks untracked exchange orders unknown when orphan cancel fails", async () => {
    const calls: string[] = [];
    const gateway: IOrderGateway = {
      async place(order) {
        calls.push(`place:${order.clientOrderId}`);
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel(id: string) {
        calls.push(`cancel:${id}`);
        throw new Error("orphan cancel failed");
      },
      async cancelAll() {
        calls.push("cancelAll");
      },
      async getOpenOrders() {
        return [
          {
            id: "orphan",
            market: "BTC-USD",
            side: "sell",
            price: 101,
            qty: 1,
            reduceOnly: false,
            timeInForce: "GTC",
            status: "open",
          },
        ];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);

    await expectUnknownStateError(manager.reconcile([]));
    expect(manager.state()).toEqual(
      expect.objectContaining({
        unknownOrderState: true,
        cancelFailures: 1,
        unknownOrderKeys: ["untracked_exchange_order:orphan"],
      }),
    );
    expect(calls).toEqual(["cancel:orphan", "cancelAll"]);
  });

  test("keeps orders when price drift is below 0.8 bps and size drift is below 15 percent", async () => {
    const calls: string[] = [];
    const gateway: IOrderGateway = {
      async place(order) {
        calls.push(`place:${order.clientOrderId}`);
        return {
          id: order.clientOrderId ?? "order",
          request: order,
          status: "open",
        } satisfies PlacedOrder;
      },
      async cancel(id: string) {
        calls.push(`cancel:${id}`);
      },
      async cancelAll() {},
      subscribeFills() {
        return () => {};
      },
    };

    const manager = new OrderManager(gateway);
    await manager.reconcile([quoteOrder({ price: 100, qty: 1, clientOrderId: "quote-1" })]);
    await manager.reconcile([quoteOrder({ price: 100.007, qty: 1.14, clientOrderId: "quote-2" })]);

    expect(calls).toEqual(["place:quote-1"]);
  });
});
