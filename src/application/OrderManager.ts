import type { OrderSide, OrderTimeInForce } from "../domain/entities/Quote.ts";
import type { IOrderGateway, OrderRequest, PlacedOrder } from "../domain/ports/IOrderGateway.ts";
import { logger } from "../utils/logger.ts";

export interface OrderManagerOptions {
  priceReplaceThresholdBps: number;
  sizeReplaceThresholdRatio: number;
  maxRestingMs: number;
  exchangeDropQuoteCooldownMs: number;
  nowMs: () => number;
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

export interface OrderManagerState {
  unknownOrderState: boolean;
  cancelFailures: number;
  unknownOrderKeys: string[];
}

export class OrderManagerUnknownStateError extends Error {
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message);
    this.name = "OrderManagerUnknownStateError";
  }
}

const defaultOptions: OrderManagerOptions = {
  priceReplaceThresholdBps: 0.8,
  sizeReplaceThresholdRatio: 0.15,
  maxRestingMs: 30_000,
  exchangeDropQuoteCooldownMs: 1_500,
  nowMs: Date.now,
};

export class OrderManager {
  private readonly activeOrders = new Map<string, { order: PlacedOrder; placedAtMs: number }>();
  private readonly unknownOrders = new Map<string, { id: string }>();
  private readonly options: OrderManagerOptions;
  private quoteCooldownUntilMs = 0;
  private cancelFailures = 0;

  constructor(
    private readonly orderGateway: IOrderGateway,
    options: Partial<OrderManagerOptions> = {},
  ) {
    this.options = { ...defaultOptions, ...options };
  }

  state(): OrderManagerState {
    return {
      unknownOrderState: this.unknownOrders.size > 0,
      cancelFailures: this.cancelFailures,
      unknownOrderKeys: [...this.unknownOrders.keys()],
    };
  }

  async reconcile(targetOrders: ReadonlyArray<ManagedOrderRequest>): Promise<ActiveManagedOrder[]> {
    const droppedTrackedOrders = await this.syncExchangeOpenOrders();
    if (droppedTrackedOrders) {
      this.quoteCooldownUntilMs = Math.max(
        this.quoteCooldownUntilMs,
        this.options.nowMs() + this.options.exchangeDropQuoteCooldownMs,
      );
    }
    const targetKeys = new Set(targetOrders.map((order) => order.key));
    const cancellations: Promise<void>[] = [];
    for (const [key, active] of this.activeOrders) {
      if (!targetKeys.has(key)) {
        cancellations.push(this.cancelTrackedOrder(key, active, "target_removed"));
      }
    }

    const activeOrders: ActiveManagedOrder[] = [];
    const ordersToPlace: ManagedOrderRequest[] = [];
    for (const target of targetOrders) {
      const previous = this.activeOrders.get(target.key);
      if (previous !== undefined && !this.shouldReplace(previous, target)) {
        activeOrders.push({
          key: target.key,
          side: target.side,
          order: previous.order,
          replaced: false,
        });
        continue;
      }
      if (previous !== undefined) {
        cancellations.push(this.cancelTrackedOrder(target.key, previous, "replace"));
      }
      if (this.shouldDelayQuotePlacement(target)) {
        logger.warn(
          `order_manager.quote_placement_delayed key=${target.key} clientOrderId=${target.clientOrderId ?? "none"} cooldownUntilMs=${this.quoteCooldownUntilMs}`,
        );
        continue;
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
    const placed = await this.orderGateway.place(request).catch((error) => {
      this.activeOrders.delete(target.key);
      logger.warn(
        `order_manager.place_failed key=${target.key} clientOrderId=${target.clientOrderId ?? "none"} market=${target.market} side=${target.side} intent=${target.intent ?? "unknown"} error=${String(error)}`,
      );
      return undefined;
    });
    if (placed === undefined) {
      return undefined;
    }
    if (placed.status === "rejected") {
      this.activeOrders.delete(target.key);
      return undefined;
    }
    this.activeOrders.set(target.key, { order: placed, placedAtMs: this.options.nowMs() });
    return { key: target.key, side: target.side, order: placed, replaced: true };
  }

  private async cancelTrackedOrder(
    key: string,
    active: { order: PlacedOrder; placedAtMs: number },
    reason: "replace" | "target_removed",
  ): Promise<void> {
    try {
      await this.orderGateway.cancel(active.order.id);
      this.activeOrders.delete(key);
      this.unknownOrders.delete(key);
    } catch (error) {
      await this.markUnknownAndCancelAll(key, active.order, reason, error);
    }
  }

  private async cancelUntrackedOrder(
    order: { id: string },
    reason: "untracked_exchange_order",
  ): Promise<void> {
    try {
      await this.orderGateway.cancel(order.id);
      this.unknownOrders.delete(`${reason}:${order.id}`);
    } catch (error) {
      await this.markUnknownAndCancelAll(`${reason}:${order.id}`, order, reason, error);
    }
  }

  private async markUnknownAndCancelAll(
    key: string,
    order: { id: string },
    reason: string,
    error: unknown,
  ): Promise<never> {
    this.cancelFailures += 1;
    this.unknownOrders.set(key, order);
    logger.error(
      `order_manager.cancel_failed_unknown_state key=${key} orderId=${order.id} reason=${reason} error=${String(error)}`,
    );
    await this.orderGateway.cancelAll().catch((cancelAllError) => {
      logger.error(
        `order_manager.cancel_all_after_cancel_failure_failed key=${key} orderId=${order.id} error=${String(cancelAllError)}`,
      );
    });
    throw new OrderManagerUnknownStateError(
      `cancel_failed_unknown_order_state key=${key} orderId=${order.id} reason=${reason}: ${String(error)}`,
      error,
    );
  }

  private shouldReplace(
    previous: { order: PlacedOrder; placedAtMs: number },
    next: ManagedOrderRequest,
  ): boolean {
    if (this.options.nowMs() - previous.placedAtMs >= this.options.maxRestingMs) {
      return true;
    }
    const previousRequest = previous.order.request;
    if (
      previousRequest.side !== next.side ||
      previousRequest.reduceOnly !== next.reduceOnly ||
      previousRequest.timeInForce !== next.timeInForce ||
      previousRequest.intent !== next.intent
    ) {
      return true;
    }
    const previousPrice = previousRequest.price;
    if (previousPrice === undefined) {
      return true;
    }
    const priceDeltaBps = (Math.abs(next.price - previousPrice) / previousPrice) * 10_000;
    if (priceDeltaBps >= this.options.priceReplaceThresholdBps) {
      return true;
    }
    const previousQty = previousRequest.qty;
    const sizeDeltaRatio =
      previousQty <= 0 ? Number.POSITIVE_INFINITY : Math.abs(next.qty - previousQty) / previousQty;
    return sizeDeltaRatio >= this.options.sizeReplaceThresholdRatio;
  }

  private async syncExchangeOpenOrders(): Promise<boolean> {
    if (this.orderGateway.getOpenOrders === undefined) {
      return false;
    }

    const exchangeOpenOrders = await this.orderGateway.getOpenOrders();
    const exchangeOpenIds = new Set(exchangeOpenOrders.map((order) => order.id));
    let droppedTrackedOrders = false;
    for (const [key, active] of this.activeOrders) {
      if (!exchangeOpenIds.has(active.order.id)) {
        this.activeOrders.delete(key);
        droppedTrackedOrders = true;
      }
    }

    const trackedOrderIds = new Set(
      [...this.activeOrders.values()].map((active) => active.order.id),
    );
    await Promise.all(
      exchangeOpenOrders
        .filter((order) => !trackedOrderIds.has(order.id))
        .map(async (order) => this.cancelUntrackedOrder(order, "untracked_exchange_order")),
    );
    return droppedTrackedOrders;
  }

  private shouldDelayQuotePlacement(target: ManagedOrderRequest): boolean {
    return target.intent === "quote" && this.options.nowMs() < this.quoteCooldownUntilMs;
  }
}
