import type { MarketSnapshot } from "./ports/IMarketFeed.ts";

export interface MarketContext extends MarketSnapshot {
  midPrice: number;
  bookUpdatedAt: number;
  tickerUpdatedAt: number;
  accountUpdatedAt: number | null;
  externalUpdatedAt: number | null;
  bookAgeMs: number;
  tickerAgeMs: number;
  accountAgeMs: number | null;
  externalAgeMs: number | null;
  localSpreadBps: number;
  positionQty: number;
  externalMid?: number;
  externalDiffBps?: number;
  externalMomentumBps?: number;
  pythPrice?: number;
  pythConfBps?: number;
  pythAgeMs?: number;
  bookImbalanceTop?: number;
  bookImbalanceDepth?: number;
  quoteAgeMs?: number;
  volBps?: number;
  volZ?: number;
}
