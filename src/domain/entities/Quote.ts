export type OrderSide = "buy" | "sell";
export type OrderTimeInForce = "ALO" | "GTC" | "IOC";
export type QuoteSideIntent = "open_quote" | "reduce_inventory" | "disabled";

export interface QuoteLevel {
  level: number;
  halfSpreadBps: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: QuoteSideIntent;
  askIntent?: QuoteSideIntent;
}

export interface Quote {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: QuoteSideIntent;
  askIntent?: QuoteSideIntent;
  bidSizeMultiplier?: number;
  askSizeMultiplier?: number;
  levels?: QuoteLevel[];
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
