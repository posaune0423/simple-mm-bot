import type { ResultAsync } from "neverthrow";
import type { PlacedOrder } from "../../domain/ports/IOrderGateway";
import type { OrderIntent } from "../../domain/value-objects/OrderIntent";

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

export type OrderReconcilerError =
  | {
      type: "order_reconcile_failed";
      cause: unknown;
    }
  | {
      type: "order_cancel_all_failed";
      reason: string;
      cause: unknown;
    };

export interface OrderReconciler {
  reconcile(intents: readonly OrderIntent[]): ResultAsync<ReconcileResult, OrderReconcilerError>;
  cancelAll(reason: string): ResultAsync<CancelAllResult, OrderReconcilerError>;
}
