export type OrderSide = "buy" | "sell";
export type OrderTimeInForce = "ALO" | "GTC" | "IOC";

export interface Quote {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  policy: OrderTimeInForce;
  fairPrice: number;
  sigma: number;
}

export interface QuoteContext {
  fairPrice: number;
  sigma: number;
  quoteSize: number;
  positionQty: number;
  inventoryScale: number;
  timeHorizonSec: number;
  minSpreadBps?: number;
  slideMarginThreshold: number;
  defaultTimeInForce: OrderTimeInForce;
  marginRatio: number | null;
}
