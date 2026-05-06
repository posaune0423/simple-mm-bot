export interface PerformanceMetrics {
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
