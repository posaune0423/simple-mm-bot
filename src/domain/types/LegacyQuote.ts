import type { OrderTimeInForce } from "./Order";
import type { ExposureIntent as DomainExposureIntent } from "../value-objects/QuoteLeg";

export type { OrderSide, OrderTimeInForce } from "./Order";

export type LegacyExposureIntent = DomainExposureIntent | "disabled";

export interface LegacyQuoteLevel {
  level: number;
  halfSpreadBps: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: LegacyExposureIntent;
  askIntent?: LegacyExposureIntent;
  bidControlReasons?: string[];
  askControlReasons?: string[];
}

export interface LegacyQuote {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: LegacyExposureIntent;
  askIntent?: LegacyExposureIntent;
  bidSizeMultiplier?: number;
  askSizeMultiplier?: number;
  bidDistanceMultiplier?: number;
  askDistanceMultiplier?: number;
  bidControlReasons?: string[];
  askControlReasons?: string[];
  levels?: LegacyQuoteLevel[];
  policy: OrderTimeInForce;
  fairPrice: number;
  sigma: number;
}

export type Quote = LegacyQuote;
export type QuoteLevel = LegacyQuoteLevel;
export type ExposureIntent = LegacyExposureIntent;
