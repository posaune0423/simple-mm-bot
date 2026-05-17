import type { OrderTimeInForce } from "./Order.ts";
import type { ExposureIntent as DomainExposureIntent } from "../value-objects/QuoteLeg.ts";

export type QuoteMetricsIntent = DomainExposureIntent | "disabled";

export interface QuoteMetricsLevel {
  level: number;
  halfSpreadBps: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: QuoteMetricsIntent;
  askIntent?: QuoteMetricsIntent;
  bidControlReasons?: string[];
  askControlReasons?: string[];
}

export interface QuoteMetricsRecord {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: QuoteMetricsIntent;
  askIntent?: QuoteMetricsIntent;
  bidSizeMultiplier?: number;
  askSizeMultiplier?: number;
  bidDistanceMultiplier?: number;
  askDistanceMultiplier?: number;
  bidControlReasons?: string[];
  askControlReasons?: string[];
  levels?: QuoteMetricsLevel[];
  policy: OrderTimeInForce;
  fairPrice: number;
  sigma: number;
  alphaDriftBps?: number;
  fundingRateBps?: number;
  expectedFundingBps?: number;
  basisBps?: number;
  targetInventoryQty?: number;
  inventoryErrorQty?: number;
}
