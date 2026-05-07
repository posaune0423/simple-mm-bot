import { describe, expect, test } from "bun:test";

import { OrderManager, type ManagedOrderRequest } from "../../src/application/OrderManager.ts";
import type { IOrderGateway, PlacedOrder } from "../../src/domain/ports/IOrderGateway.ts";

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
});
