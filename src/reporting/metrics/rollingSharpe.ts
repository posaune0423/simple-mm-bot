import type { Fill } from "../../domain/entities/Fill.ts";

export interface RollingSharpePoint {
  timestamp: number;
  sharpe: number;
}

export function computeRollingSharpe(
  fills: ReadonlyArray<Fill>,
  windowSize = 60,
  annualize = 365,
): RollingSharpePoint[] {
  if (fills.length < 2 || windowSize < 2) return [];
  const returns = fills.map((fill) => fill.tradePnl - fill.fee);
  const result: RollingSharpePoint[] = [];
  for (let end = windowSize; end <= fills.length; end += 1) {
    const start = end - windowSize;
    const window = returns.slice(start, end);
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (window.length - 1);
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(annualize) : 0;
    const fill = fills[end - 1];
    if (fill === undefined) continue;
    result.push({ timestamp: fill.filledAt, sharpe });
  }
  return result;
}
