export type ReportSide = "buy" | "sell";

export interface ReportFill {
  id: string;
  venue: string;
  market: string;
  side: ReportSide;
  price: number;
  qty: number;
  fee: number;
  tradePnl: number;
  filledAt: number;
  quoteId?: string;
  markPriceAtFill?: number;
  markPrice5s?: number;
  markPrice30s?: number;
  makerTaker?: "maker" | "taker" | "unknown";
}

export interface ReportPerformanceMetrics {
  netPnl: number;
  tradePnl: number;
  markout5s: number;
  markout30s: number;
  notionalUsd?: number | null;
  netEvBps?: number | null;
  feeBps?: number | null;
  vwMarkout5sBps?: number | null;
  vwMarkout30sBps?: number | null;
  p5Markout30sBps?: number | null;
  p1Markout30sBps?: number | null;
  markoutCoverage?: number | null;
  makerRatio?: number | null;
  avgQuoteAgeMs?: number | null;
  maxAbsPosition?: number | null;
  reduceCount?: number;
  maxDrawdown: number;
  sharpe: number;
  fillRate: number;
}

export interface ReportEquityPoint {
  timestamp: number;
  value: number;
}

export interface ReportFillAnalysis {
  adverseSelectionCount: number;
  fillCount: number;
}
