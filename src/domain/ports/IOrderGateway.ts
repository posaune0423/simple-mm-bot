import type { Fill } from "../entities/Fill.ts";
import type { Position } from "../entities/Position.ts";
import type { OrderSide, OrderTimeInForce } from "../entities/Quote.ts";

export interface OrderRequest {
  market: string;
  side: OrderSide;
  price?: number;
  qty: number;
  reduceOnly: boolean;
  timeInForce: OrderTimeInForce;
  clientOrderId?: string;
}

export interface PlacedOrder {
  id: string;
  request: OrderRequest;
  status: "open" | "filled" | "partially_filled" | "cancelled" | "rejected";
}

export type FillListener = (fill: Fill) => void | Promise<void>;

export interface IOrderGateway {
  place(order: OrderRequest): Promise<PlacedOrder>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  subscribeFills(listener: FillListener): () => void;
  syncFills?(): Promise<void>;
  getPosition?(): Promise<Position>;
  dispose?(): void | Promise<void>;
}
