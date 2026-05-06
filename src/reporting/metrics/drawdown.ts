import type { EquityPoint } from "../../domain/entities/Report.ts";

export interface DrawdownPoint {
  timestamp: number;
  drawdown: number;
}

export function computeDrawdown(equityCurve: ReadonlyArray<EquityPoint>): DrawdownPoint[] {
  let peak = 0;
  return equityCurve.map((point) => {
    peak = Math.max(peak, point.value);
    return { timestamp: point.timestamp, drawdown: point.value - peak };
  });
}
