import type { OrderSide, OrderTimeInForce } from "../domain/entities/Quote.ts";
import type { IOrderGateway, OrderRequest, PlacedOrder } from "../domain/ports/IOrderGateway.ts";

interface OrderManagerOptions {
  priceReplaceThresholdBps: number;
  sizeReplaceThresholdRatio: number;
}

export interface ManagedOrderRequest extends OrderRequest {
  key: string;
  side: OrderSide;
  price: number;
  qty: number;
  timeInForce: OrderTimeInForce;
}

export interface ActiveManagedOrder {
  key: string;
  side: OrderSide;
  order: PlacedOrder;
  replaced: boolean;
}

const defaultOptions: OrderManagerOptions = {
  priceReplaceThresholdBps: 0.2,
  sizeReplaceThresholdRatio: 0.05,
};

export class OrderManager {
  private readonly activeOrders = new Map<string, PlacedOrder>();

  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly options: OrderManagerOptions = defaultOptions,
  ) {}

  async reconcile(targetOrders: ReadonlyArray<ManagedOrderRequest>): Promise<ActiveManagedOrder[]> {
    const targetKeys = new Set(targetOrders.map((order) => order.key));
    const cancellations: Promise<void>[] = [];
    for (const [key, order] of this.activeOrders) {
      if (!targetKeys.has(key)) {
        cancellations.push(this.orderGateway.cancel(order.id));
        this.activeOrders.delete(key);
      }
    }

    const activeOrders: ActiveManagedOrder[] = [];
    const ordersToPlace: ManagedOrderRequest[] = [];
    for (const target of targetOrders) {
      const previous = this.activeOrders.get(target.key);
      if (previous !== undefined && !this.shouldReplace(previous.request, target)) {
        activeOrders.push({ key: target.key, side: target.side, order: previous, replaced: false });
        continue;
      }
      if (previous !== undefined) {
        cancellations.push(this.orderGateway.cancel(previous.id));
      }
      ordersToPlace.push(target);
    }

    await Promise.all(cancellations);
    const placedOrders = await Promise.all(ordersToPlace.map(async (target) => this.place(target)));
    return [
      ...activeOrders,
      ...placedOrders.filter((placed): placed is ActiveManagedOrder => placed !== undefined),
    ];
  }

  private async place(target: ManagedOrderRequest): Promise<ActiveManagedOrder | undefined> {
    const { key: _key, ...request } = target;
    const placed = await this.orderGateway.place(request);
    if (placed.status === "rejected") {
      this.activeOrders.delete(target.key);
      return undefined;
    }
    this.activeOrders.set(target.key, placed);
    return { key: target.key, side: target.side, order: placed, replaced: true };
  }

  private shouldReplace(previous: OrderRequest, next: ManagedOrderRequest): boolean {
    if (
      previous.side !== next.side ||
      previous.reduceOnly !== next.reduceOnly ||
      previous.timeInForce !== next.timeInForce ||
      previous.intent !== next.intent
    ) {
      return true;
    }
    const previousPrice = previous.price;
    if (previousPrice === undefined) {
      return true;
    }
    const priceDeltaBps = (Math.abs(next.price - previousPrice) / previousPrice) * 10_000;
    if (priceDeltaBps >= this.options.priceReplaceThresholdBps) {
      return true;
    }
    const previousQty = previous.qty;
    const sizeDeltaRatio =
      previousQty <= 0 ? Number.POSITIVE_INFINITY : Math.abs(next.qty - previousQty) / previousQty;
    return sizeDeltaRatio >= this.options.sizeReplaceThresholdRatio;
  }
}
