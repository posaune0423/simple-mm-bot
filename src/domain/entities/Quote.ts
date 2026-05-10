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
  bidControlReasons?: string[];
  askControlReasons?: string[];
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
  bidDistanceMultiplier?: number;
  askDistanceMultiplier?: number;
  bidControlReasons?: string[];
  askControlReasons?: string[];
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
