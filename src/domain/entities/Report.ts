export interface ReportMetrics {
  netPnl: number;
  tradePnl: number;
  markout5s: number;
  markout30s: number;
  maxDrawdown: number;
  sharpe: number;
  fillRate: number;
}

export interface EquityPoint {
  timestamp: number;
  value: number;
}

export interface FillAnalysis {
  adverseSelectionCount: number;
  fillCount: number;
}

export interface Report {
  id: string;
  mode: "live" | "paper" | "backtest";
  venue: string;
  periodStart: number;
  periodEnd: number;
  metrics: ReportMetrics;
  equityCurve: EquityPoint[];
  fillAnalysis: FillAnalysis;
}
