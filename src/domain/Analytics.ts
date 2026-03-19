import type { Fill } from "./entities/Fill.ts";
import type { FillAnalysis, ReportMetrics } from "./entities/Report.ts";

export interface AnalyticsInput {
  fills: Fill[];
  quotedCount: number;
}

export class Analytics {
  build({ fills, quotedCount }: AnalyticsInput): {
    metrics: ReportMetrics;
    fillAnalysis: FillAnalysis;
    equityCurve: Array<{ timestamp: number; value: number }>;
  } {
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const returns: number[] = [];
    let markout5s = 0;
    let markout30s = 0;
    let adverseSelectionCount = 0;

    const equityCurve = fills.map((fill) => {
      const net = fill.tradePnl - fill.fee;
      cumulative += net;
      peak = Math.max(peak, cumulative);
      maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
      returns.push(net);

      const localMarkout5s =
        fill.markPrice5s !== undefined && fill.markPriceAtFill !== undefined
          ? fill.side === "buy"
            ? fill.markPrice5s - fill.markPriceAtFill
            : fill.markPriceAtFill - fill.markPrice5s
          : 0;
      const localMarkout30s =
        fill.markPrice30s !== undefined && fill.markPriceAtFill !== undefined
          ? fill.side === "buy"
            ? fill.markPrice30s - fill.markPriceAtFill
            : fill.markPriceAtFill - fill.markPrice30s
          : 0;

      markout5s += localMarkout5s;
      markout30s += localMarkout30s;
      if (localMarkout5s < 0 || localMarkout30s < 0) {
        adverseSelectionCount += 1;
      }

      return {
        timestamp: fill.filledAt,
        value: cumulative,
      };
    });

    const avgReturn =
      returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
    const variance =
      returns.length > 1
        ? returns.reduce((sum, value) => sum + (value - avgReturn) ** 2, 0) / (returns.length - 1)
        : 0;
    const sharpe = variance > 0 ? (avgReturn / Math.sqrt(variance)) * Math.sqrt(365) : 0;
    const tradePnl = fills.reduce((sum, fill) => sum + fill.tradePnl, 0);
    const netPnl = fills.reduce((sum, fill) => sum + fill.tradePnl - fill.fee, 0);

    return {
      metrics: {
        netPnl,
        tradePnl,
        markout5s,
        markout30s,
        maxDrawdown,
        sharpe,
        fillRate: quotedCount > 0 ? fills.length / quotedCount : 0,
      },
      fillAnalysis: {
        adverseSelectionCount,
        fillCount: fills.length,
      },
      equityCurve,
    };
  }
}
