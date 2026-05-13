import type { ResultAsync } from "neverthrow";
import type { PlacedOrder } from "../../domain/ports/IOrderGateway";
import type { OrderIntent } from "../../domain/value-objects/OrderIntent";
import { ApplicationError } from "../errors/ApplicationError";

export type ReconcileResult = Readonly<{
  activeOrders: readonly {
    key: string;
    side: "buy" | "sell";
    order: PlacedOrder;
    replaced: boolean;
  }[];
}>;

export type CancelAllResult = Readonly<{
  reason: string;
}>;

export type OrderReconcilerError = OrderReconcileFailedError | OrderCancelAllFailedError;

export abstract class OrderReconcilerBaseError extends ApplicationError {
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

export interface OrderReconciler {
  reconcile(intents: readonly OrderIntent[]): ResultAsync<ReconcileResult, OrderReconcilerError>;
  cancelAll(reason: string): ResultAsync<CancelAllResult, OrderReconcilerError>;
}
