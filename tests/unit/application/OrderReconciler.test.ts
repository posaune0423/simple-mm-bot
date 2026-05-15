import { describe, expect, test } from "bun:test";

import { OrderReconciler } from "../../../src/application/services/OrderReconciler.ts";
import type { IOrderGateway, PlacedOrder } from "../../../src/domain/ports/IOrderGateway.ts";
import type { OrderIntent } from "../../../src/domain/value-objects/OrderIntent.ts";
import { Price } from "../../../src/domain/value-objects/Price.ts";
import { Quantity } from "../../../src/domain/value-objects/Quantity.ts";

async function expectUnknownStateError(
  promise: ReturnType<OrderReconciler["reconcile"]>,
): Promise<void> {
  const result = await promise;
  expect(result.isErr()).toBe(true);
  expect(String(result._unsafeUnwrapErr().cause)).toContain("cancel_failed_unknown_order_state");
}

async function activeOrders(promise: ReturnType<OrderReconciler["reconcile"]>) {
  return (await promise)._unsafeUnwrap().activeOrders;
}

function quoteOrder(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    key: "bid",
    market: "BTC-USD",
    orderSide: "buy",
    price: Price.unsafe(100),
    quantity: Quantity.unsafe(1),
    reduceOnly: false,
    timeInForce: "GTC",
    postOnly: true,
    clientOrderId: "quote-1",
    exposureIntent: "increase_exposure",
    sourceQuoteSide: "bid",
    sourceQuoteLevel: 0,
    reasonTags: [],
    ...overrides,
  };
}

function reduceOrder(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return quoteOrder({
    key: "ask",
    orderSide: "sell",
    price: Price.unsafe(101),
    quantity: Quantity.unsafe(0.1),
    reduceOnly: true,
    clientOrderId: "reduce-1",
    exposureIntent: "reduce_exposure",
    sourceQuoteSide: "ask",
    ...overrides,
  });
}

describe("OrderReconciler", () => {
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

    const reconciler = new OrderReconciler(gateway);
    await activeOrders(reconciler.reconcile([quoteOrder()]));

    const reconcile = reconciler.reconcile([
      quoteOrder({ price: Price.unsafe(101), clientOrderId: "quote-2" }),
    ]);
    await Promise.resolve();

    expect(secondPlaceSawFinishedCancel).toBeUndefined();
    releaseCancel?.();
    await activeOrders(reconcile);
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

    const reconciler = new OrderReconciler(gateway);
    const firstActive = await activeOrders(reconciler.reconcile([quoteOrder()]));
    const secondActive = await activeOrders(reconciler.reconcile([quoteOrder()]));

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

    const reconciler = new OrderReconciler(gateway);
    const active = await activeOrders(
      reconciler.reconcile([
        quoteOrder({ key: "bad", clientOrderId: "bad", quantity: Quantity.unsafe(0.000001) }),
        quoteOrder({
          key: "good",
          clientOrderId: "good",
          orderSide: "sell",
          price: Price.unsafe(101),
          sourceQuoteSide: "ask",
        }),
      ]),
    );

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

    const reconciler = new OrderReconciler(gateway, {
      exchangeDropQuoteCooldownMs: 1_500,
      nowMs: () => nowMs,
    });
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-2" })]));
    nowMs = 2_501;
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-3" })]));

    expect(calls).toEqual(["place:quote-1", "place:quote-3"]);
  });

  test("does not delay open quotes when only reduce orders disappear from the exchange", async () => {
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
      async cancel() {},
      async cancelAll() {},
      async getOpenOrders() {
        return [];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const reconciler = new OrderReconciler(gateway, {
      exchangeDropQuoteCooldownMs: 1_500,
    });
    await activeOrders(reconciler.reconcile([reduceOrder({ clientOrderId: "reduce-1" })]));
    await activeOrders(
      reconciler.reconcile([
        reduceOrder({ clientOrderId: "reduce-2" }),
        quoteOrder({ clientOrderId: "quote-1" }),
      ]),
    );

    expect(calls).toEqual(["place:reduce-1", "place:reduce-2", "place:quote-1"]);
    expect(reconciler.state().quoteCooldownRemainingMs).toBe(0);
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

    const reconciler = new OrderReconciler(gateway, {
      exchangeDropQuoteCooldownMs: 1_500,
      nowMs: () => nowMs,
    });
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));
    expect(reconciler.state()).toEqual(
      expect.objectContaining({
        trackedOrderCount: 1,
        quoteCooldownUntilMs: 0,
        quoteCooldownRemainingMs: 0,
      }),
    );

    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-2" })]));
    expect(reconciler.state()).toEqual(
      expect.objectContaining({
        trackedOrderCount: 0,
        quoteCooldownUntilMs: 2_500,
        quoteCooldownRemainingMs: 1_500,
      }),
    );

    nowMs = 2_501;
    expect(reconciler.state()).toEqual(
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

    const reconciler = new OrderReconciler(gateway);
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));
    await activeOrders(
      reconciler.reconcile([
        quoteOrder({
          clientOrderId: "reduce-1",
          exposureIntent: "reduce_exposure",
          orderSide: "sell",
          reduceOnly: true,
          sourceQuoteSide: "ask",
        }),
      ]),
    );

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

    const reconciler = new OrderReconciler(gateway);
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-2" })]));

    expect(calls).toEqual(["place:quote-1", "cancel:orphan"]);
  });

  test("throttles exchange open-order sync when an interval is configured", async () => {
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
        calls.push("sync");
        return [];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const reconciler = new OrderReconciler(gateway, {
      exchangeOpenOrderSyncIntervalMs: 2_000,
      exchangeDropQuoteCooldownMs: 0,
      nowMs: () => nowMs,
    });

    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));
    nowMs = 1_500;
    await activeOrders(
      reconciler.reconcile([quoteOrder({ price: Price.unsafe(101), clientOrderId: "quote-2" })]),
    );
    nowMs = 3_001;
    await activeOrders(
      reconciler.reconcile([quoteOrder({ price: Price.unsafe(102), clientOrderId: "quote-3" })]),
    );

    expect(calls).toEqual([
      "sync",
      "place:quote-1",
      "cancel:quote-1",
      "sync",
      "place:quote-2",
      "cancel:quote-2",
      "sync",
      "place:quote-3",
    ]);
  });

  test("scrubs lingering exchange orders after cancellation before placing replacements", async () => {
    const calls: string[] = [];
    let nowMs = 1_000;
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
        calls.push("sync");
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
        ];
      },
      subscribeFills() {
        return () => {};
      },
    };

    const reconciler = new OrderReconciler(gateway, {
      exchangeOpenOrderSyncIntervalMs: 1_500,
      maxRestingMs: 1_000,
      nowMs: () => nowMs,
    });

    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));
    nowMs = 2_100;
    await activeOrders(
      reconciler.reconcile([quoteOrder({ price: Price.unsafe(101), clientOrderId: "quote-2" })]),
    );

    expect(calls).toEqual([
      "sync",
      "place:quote-1",
      "cancel:quote-1",
      "sync",
      "cancel:quote-1",
      "place:quote-2",
    ]);
  });

  test("uses interval exchange sync instead of blocking post-cancel scrub when configured", async () => {
    const calls: string[] = [];
    let nowMs = 1_000;
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
        calls.push("sync");
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
            id: "quote-2",
            market: "BTC-USD",
            side: "buy",
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

    const reconciler = new OrderReconciler(gateway, {
      exchangeOpenOrderSyncIntervalMs: 1_500,
      maxRestingMs: 10_000,
      nowMs: () => nowMs,
      postCancelOpenOrderSyncMode: "interval",
    });

    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));
    nowMs = 2_100;
    await activeOrders(
      reconciler.reconcile([quoteOrder({ price: Price.unsafe(101), clientOrderId: "quote-2" })]),
    );
    nowMs = 3_700;
    await activeOrders(
      reconciler.reconcile([quoteOrder({ price: Price.unsafe(101), clientOrderId: "quote-2" })]),
    );

    expect(calls).toEqual([
      "sync",
      "place:quote-1",
      "cancel:quote-1",
      "place:quote-2",
      "sync",
      "cancel:quote-1",
    ]);
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

    const reconciler = new OrderReconciler(gateway);
    await activeOrders(reconciler.reconcile([quoteOrder({ clientOrderId: "quote-1" })]));

    await expectUnknownStateError(reconciler.reconcile([]));
    expect(reconciler.state()).toEqual(
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

    const reconciler = new OrderReconciler(gateway);

    await expectUnknownStateError(reconciler.reconcile([]));
    expect(reconciler.state()).toEqual(
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

    const reconciler = new OrderReconciler(gateway);
    await activeOrders(
      reconciler.reconcile([
        quoteOrder({
          price: Price.unsafe(100),
          quantity: Quantity.unsafe(1),
          clientOrderId: "quote-1",
        }),
      ]),
    );
    await activeOrders(
      reconciler.reconcile([
        quoteOrder({
          price: Price.unsafe(100.007),
          quantity: Quantity.unsafe(1.14),
          clientOrderId: "quote-2",
        }),
      ]),
    );

    expect(calls).toEqual(["place:quote-1"]);
  });
});
