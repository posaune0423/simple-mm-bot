import type { OrderSide } from "./Quote.ts";

export interface Fill {
  id: string;
  venue: string;
  market: string;
  side: OrderSide;
  price: number;
  qty: number;
  fee: number;
  tradePnl: number;
  filledAt: number;
  quoteId?: string;
  markPriceAtFill?: number;
  markPrice5s?: number;
  markPrice30s?: number;
}
