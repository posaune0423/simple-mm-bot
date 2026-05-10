import type { OrderSide } from "./entities/Quote.ts";

export interface QuoteQualityHorizon {
  horizonSec: number;
  sampleCount: number;
  averageMarkoutBps: number | null;
}

export interface QuoteSideQuality {
  side: OrderSide;
  horizons: QuoteQualityHorizon[];
}
