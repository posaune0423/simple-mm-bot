import type { ReportEquityPoint } from "../types.ts";

interface DrawdownPoint {
  timestamp: number;
  drawdown: number;
}

export function computeDrawdown(equityCurve: ReadonlyArray<ReportEquityPoint>): DrawdownPoint[] {
  let peak = 0;
  return equityCurve.map((point) => {
    peak = Math.max(peak, point.value);
    return { timestamp: point.timestamp, drawdown: point.value - peak };
  });
}
