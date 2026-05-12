export type OrderSide = "buy" | "sell";
export type OrderTimeInForce = "ALO" | "GTC" | "IOC";
export type ExposureIntent = "increase_exposure" | "reduce_exposure" | "disabled";

export interface QuoteLevel {
  level: number;
  halfSpreadBps: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: ExposureIntent;
  askIntent?: ExposureIntent;
  bidControlReasons?: string[];
  askControlReasons?: string[];
}

export interface Quote {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: ExposureIntent;
  askIntent?: ExposureIntent;
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
