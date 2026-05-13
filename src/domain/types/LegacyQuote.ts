import type { OrderTimeInForce } from "./Order";
import type { ExposureIntent as DomainExposureIntent } from "../value-objects/QuoteLeg";

type LegacyExposureIntent = DomainExposureIntent | "disabled";

interface LegacyQuoteLevel {
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

interface LegacyQuote {
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

/** @deprecated Use `LegacyQuote` in new code. */
export type Quote = LegacyQuote;
/** @deprecated Use `LegacyQuoteLevel` in new code. */
export type QuoteLevel = LegacyQuoteLevel;
/** @deprecated Use `LegacyExposureIntent` in new code. */
export type ExposureIntent = LegacyExposureIntent;
