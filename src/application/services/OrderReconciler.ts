import type { ResultAsync } from "neverthrow";
import type { OrderSide, OrderTimeInForce } from "../../domain/types/Order.ts";
import type { IOrderGateway, OrderRequest, PlacedOrder } from "../../domain/ports/IOrderGateway.ts";
import type { OrderIntent } from "../../domain/value-objects/OrderIntent.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";
import { tryCatchAsync } from "../../utils/result.ts";
import { ApplicationError } from "../errors/ApplicationError.ts";

export type ReconcileResult = Readonly<{
  activeOrders: readonly {
    key: string;
    side: "buy" | "sell";
    order: PlacedOrder;
    replaced: boolean;
  }[];
}>;

type CancelAllResult = Readonly<{
  reason: string;
}>;

type OrderReconcilerError = OrderReconcileFailedError | OrderCancelAllFailedError;

abstract class OrderReconcilerBaseError extends ApplicationError {
  abstract override readonly code: string;

  protected constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
  }
}

export class OrderReconcileFailedError extends OrderReconcilerBaseError {
  readonly code = "application.order_reconciler.reconcile_failed";

  constructor(cause: unknown) {
    super("order reconciliation failed", { cause });
  }
}

export class OrderCancelAllFailedError extends OrderReconcilerBaseError {
  readonly code = "application.order_reconciler.cancel_all_failed";

  constructor(
    readonly reason: string,
    cause: unknown,
  ) {
    super(`order cancel all failed: ${reason}`, { cause });
  }
}

export interface OrderReconcilerOptions {
  priceReplaceThresholdBps: number;
  sizeReplaceThresholdRatio: number;
  maxRestingMs: number;
  exchangeDropQuoteCooldownMs: number;
  exchangeOpenOrderSyncIntervalMs: number;
  postCancelOpenOrderSyncMode: "blocking" | "interval";
  nowMs: () => number;
}

interface ReconciliationTarget extends OrderRequest {
  key: string;
  side: OrderSide;
  price: number;
  qty: number;
  timeInForce: OrderTimeInForce;
}

interface ActiveOrder {
  key: string;
  side: OrderSide;
  order: PlacedOrder;
  replaced: boolean;
}

interface OrderReconcilerState {
  unknownOrderState: boolean;
  cancelFailures: number;
  unknownOrderKeys: string[];
  trackedOrderCount: number;
  trackedOrderKeys: string[];
  quoteCooldownUntilMs: number;
  quoteCooldownRemainingMs: number;
}

class OrderReconcilerUnknownStateError extends Error {
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message);
    this.name = "OrderReconcilerUnknownStateError";
  }
}

const defaultOptions: OrderReconcilerOptions = {
  priceReplaceThresholdBps: 0.8,
  sizeReplaceThresholdRatio: 0.15,
  maxRestingMs: 30_000,
  exchangeDropQuoteCooldownMs: 1_500,
  exchangeOpenOrderSyncIntervalMs: 0,
  postCancelOpenOrderSyncMode: "blocking",
  nowMs: Date.now,
};

export class OrderReconciler {
  private readonly activeOrders = new Map<string, { order: PlacedOrder; placedAtMs: number }>();
  private readonly unknownOrders = new Map<string, { id: string }>();
  private readonly options: OrderReconcilerOptions;
  private quoteCooldownUntilMs = 0;
  private cancelFailures = 0;
  private lastExchangeOpenOrderSyncAtMs: number | null = null;

  constructor(
    private readonly orderGateway: IOrderGateway,
    options: Partial<OrderReconcilerOptions> = {},
  ) {
    this.options = { ...defaultOptions, ...options };
  }

  state(): OrderReconcilerState {
    const nowMs = this.options.nowMs();
    return {
      unknownOrderState: this.unknownOrders.size > 0,
      cancelFailures: this.cancelFailures,
      unknownOrderKeys: [...this.unknownOrders.keys()],
      trackedOrderCount: this.activeOrders.size,
      trackedOrderKeys: [...this.activeOrders.keys()],
      quoteCooldownUntilMs: this.quoteCooldownUntilMs,
      quoteCooldownRemainingMs: Math.max(0, this.quoteCooldownUntilMs - nowMs),
    };
  }

  reconcile(intents: readonly OrderIntent[]): ResultAsync<ReconcileResult, OrderReconcilerError> {
    return tryCatchAsync(
      this.reconcileTargets(intents.map(toReconciliationTarget)),
      (cause): OrderReconcilerError => new OrderReconcileFailedError(cause),
    ).map(
      (activeOrders): ReconcileResult => ({
        activeOrders,
      }),
    );
  }

  cancelAll(reason: string): ResultAsync<CancelAllResult, OrderReconcilerError> {
    return tryCatchAsync(
      this.cancelAllTargets(reason),
      (cause): OrderReconcilerError => new OrderCancelAllFailedError(reason, cause),
    ).map(
      (): CancelAllResult => ({
        reason,
      }),
    );
  }

  private async reconcileTargets(
    targetOrders: ReadonlyArray<ReconciliationTarget>,
  ): Promise<ActiveOrder[]> {
    const droppedTrackedQuoteOrders = await this.syncExchangeOpenOrders();
    if (droppedTrackedQuoteOrders) {
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

    const activeOrders: ActiveOrder[] = [];
    const ordersToPlace: ReconciliationTarget[] = [];
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
        logger.debug(
          `[application] OrderReconciler | QUOTE_PLACEMENT_DELAYED | key=${target.key} clientOrderId=${target.clientOrderId ?? "none"} cooldownUntilMs=${this.quoteCooldownUntilMs}`,
        );
        continue;
      }
      ordersToPlace.push(target);
    }

    await Promise.all(cancellations);
    if (cancellations.length > 0 && this.options.postCancelOpenOrderSyncMode === "blocking") {
      await this.syncExchangeOpenOrders({ force: true });
    }
    const placedOrders = await Promise.all(ordersToPlace.map(async (target) => this.place(target)));
    return [
      ...activeOrders,
      ...placedOrders.filter((placed): placed is ActiveOrder => placed !== undefined),
    ];
  }

  private async cancelAllTargets(reason: string): Promise<void> {
    logger.info(`[application] OrderReconciler | CANCEL_ALL | reason=${reason}`);
    await this.orderGateway.cancelAll();
    this.activeOrders.clear();
    this.unknownOrders.clear();
  }

  private async place(target: ReconciliationTarget): Promise<ActiveOrder | undefined> {
    const { key: _key, ...request } = target;
    const placed = await this.orderGateway.place(request).catch((error) => {
      this.activeOrders.delete(target.key);
      logger.warn(
        `[application] OrderReconciler | PLACE_FAILED | key=${target.key} clientOrderId=${target.clientOrderId ?? "none"} market=${target.market} side=${target.side} intent=${target.intent ?? "unknown"} error=${stringifyError(error)}`,
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
      `[application] OrderReconciler | CANCEL_FAILED_UNKNOWN_STATE | key=${key} orderId=${order.id} reason=${reason} error=${stringifyError(error)}`,
    );
    await this.orderGateway.cancelAll().catch((cancelAllError) => {
      logger.error(
        `[application] OrderReconciler | CANCEL_ALL_AFTER_CANCEL_FAILURE_FAILED | key=${key} orderId=${order.id} error=${stringifyError(cancelAllError)}`,
      );
    });
    throw new OrderReconcilerUnknownStateError(
      `cancel_failed_unknown_order_state key=${key} orderId=${order.id} reason=${reason}: ${stringifyError(error)}`,
      error,
    );
  }

  private shouldReplace(
    previous: { order: PlacedOrder; placedAtMs: number },
    next: ReconciliationTarget,
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

  private async syncExchangeOpenOrders(options: { force?: boolean } = {}): Promise<boolean> {
    if (this.orderGateway.getOpenOrders === undefined) {
      return false;
    }
    const nowMs = this.options.nowMs();
    if (
      options.force !== true &&
      this.options.exchangeOpenOrderSyncIntervalMs > 0 &&
      this.lastExchangeOpenOrderSyncAtMs !== null &&
      nowMs - this.lastExchangeOpenOrderSyncAtMs < this.options.exchangeOpenOrderSyncIntervalMs
    ) {
      return false;
    }

    const exchangeOpenOrders = await this.orderGateway.getOpenOrders();
    this.lastExchangeOpenOrderSyncAtMs = nowMs;
    const exchangeOpenIds = new Set(exchangeOpenOrders.map((order) => order.id));
    let droppedTrackedQuoteOrders = false;
    for (const [key, active] of this.activeOrders) {
      if (!exchangeOpenIds.has(active.order.id)) {
        this.activeOrders.delete(key);
        if (active.order.request.intent === "quote") {
          droppedTrackedQuoteOrders = true;
        }
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
    return droppedTrackedQuoteOrders;
  }

  private shouldDelayQuotePlacement(target: ReconciliationTarget): boolean {
    return target.intent === "quote" && this.options.nowMs() < this.quoteCooldownUntilMs;
  }
}

function toReconciliationTarget(intent: OrderIntent): ReconciliationTarget {
  return {
    key: intent.key,
    market: intent.market,
    side: intent.orderSide,
    price: intent.price,
    qty: intent.quantity,
    reduceOnly: intent.reduceOnly,
    timeInForce: intent.timeInForce,
    clientOrderId: intent.clientOrderId,
    intent: intent.exposureIntent === "reduce_exposure" ? "reduce" : "quote",
  };
}
