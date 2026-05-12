import { describe, expect, test } from "bun:test";

import { ManagedOrderReconciler } from "../../../src/application/services/ManagedOrderReconciler";
import type {
  IOrderGateway,
  OrderRequest,
  PlacedOrder,
} from "../../../src/domain/ports/IOrderGateway";
import { MarketId } from "../../../src/domain/value-objects/MarketId";
import { OrderIntent } from "../../../src/domain/value-objects/OrderIntent";
import { Price } from "../../../src/domain/value-objects/Price";
import { Quantity } from "../../../src/domain/value-objects/Quantity";

describe("ManagedOrderReconciler intent mapping", () => {
  test("converts order intents to managed order requests", async () => {
    const gateway = new FakeOrderGateway();
    const reconciler = new ManagedOrderReconciler(gateway);

    const result = await reconciler.reconcile([
      OrderIntent.create({
        key: "bid:0",
        market: MarketId.unsafe("BTC-USD"),
        orderSide: "buy",
        price: Price.unsafe(99),
        quantity: Quantity.unsafe(1),
        timeInForce: "ALO",
        postOnly: true,
        reduceOnly: false,
        exposureIntent: "increase_exposure",
        sourceQuoteSide: "bid",
        sourceQuoteLevel: 0,
        reasonTags: [],
        clientOrderId: "cycle-1:bid:0",
      })._unsafeUnwrap(),
    ]);

    expect(result.isOk()).toBe(true);
    expect(gateway.placed[0]).toMatchObject({
      market: "BTC-USD",
      side: "buy",
      price: 99,
      qty: 1,
      reduceOnly: false,
      timeInForce: "ALO",
      clientOrderId: "cycle-1:bid:0",
      intent: "quote",
    });
  });

  test("maps cancelAll failure to Err", async () => {
    const gateway = new FakeOrderGateway({ cancelAllError: new Error("cancel failed") });
    const reconciler = new ManagedOrderReconciler(gateway);

    const result = await reconciler.cancelAll("risk_pause");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("order_cancel_all_failed");
  });
});

class FakeOrderGateway implements IOrderGateway {
  readonly placed: OrderRequest[] = [];

  constructor(private readonly options: { cancelAllError?: Error } = {}) {}

  async place(order: OrderRequest): Promise<PlacedOrder> {
    this.placed.push(order);
    return {
      id: `order-${this.placed.length}`,
      request: order,
      status: "open",
    };
  }

  async cancel(): Promise<void> {}

  async cancelAll(): Promise<void> {
    if (this.options.cancelAllError !== undefined) {
      throw this.options.cancelAllError;
    }
  }

  subscribeFills() {
    return () => {};
  }
}
