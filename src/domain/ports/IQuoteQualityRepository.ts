import type { QuoteSideQuality } from "../QuoteQuality.ts";

export interface QuoteQualityQuery {
  market: string;
  lookbackFills: number;
  horizonsSec: number[];
}

export interface IQuoteQualityRepository {
  getRecentSideQuality(query: QuoteQualityQuery): Promise<QuoteSideQuality[]>;
}

export type { QuoteSideQuality };
