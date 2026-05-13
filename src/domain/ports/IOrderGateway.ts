import type { Fill } from "../types/Fill.ts";
import type { Position } from "../types/Position.ts";
import type { OrderSide, OrderTimeInForce } from "../types/Order.ts";

export interface OrderRequest {
  market: string;
  side: OrderSide;
  price?: number;
  qty: number;
  reduceOnly: boolean;
  timeInForce: OrderTimeInForce;
  clientOrderId?: string;
  intent?: "quote" | "reduce" | "close";
}

export interface PlacedOrder {
  id: string;
  request: OrderRequest;
  status: "open" | "filled" | "partially_filled" | "cancelled" | "rejected";
}

export interface OpenOrder {
  id: string;
  market: string;
  side: OrderSide;
  price?: number;
  qty: number;
  reduceOnly: boolean;
  timeInForce: OrderTimeInForce;
  status: "open" | "partially_filled";
  placedAtMs?: number;
}

export interface OrderGatewayEvent {
  action: "submit" | "ack" | "cancel" | "reject" | "fill";
  clientOrderId?: string;
  orderId?: string;
  intent?: "quote" | "reduce" | "close";
  side?: OrderSide;
  orderType?: "limit" | "market";
  price?: number;
  qty?: number;
  reduceOnly?: boolean;
  timeInForce?: OrderTimeInForce;
  latencyMs?: number;
  status?: string;
  statusKey?: string;
  reason?: string;
  rawSummary?: unknown;
}

export type FillListener = (fill: Fill) => void | Promise<void>;
export type OrderEventListener = (event: OrderGatewayEvent) => void | Promise<void>;

export interface IOrderGateway {
  place(order: OrderRequest): Promise<PlacedOrder>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  subscribeFills(listener: FillListener): () => void;
  subscribeOrderEvents?(listener: OrderEventListener): () => void;
  syncFills?(): Promise<void>;
  getOpenOrders?(): Promise<OpenOrder[]>;
  getPosition?(): Promise<Position>;
  stopBackgroundSync?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
