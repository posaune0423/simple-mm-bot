/** OHLCV candle with open time in Unix ms (venue-agnostic). */
export interface OhlcvBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev <= 0 || cur <= 0 || !Number.isFinite(prev) || !Number.isFinite(cur)) {
      out.push(Number.NaN);
      continue;
    }
    out.push(Math.log(cur / prev));
  }
  return out;
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) {
    return null;
  }
  let sumA = 0;
  let sumB = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    sumA += x;
    sumB += y;
    count += 1;
  }
  if (count < 3) {
    return null;
  }
  const meanA = sumA / count;
  const meanB = sumB / count;
  let num = 0;
  let denA = 0;
  let denB = 0;
  let used = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    const da = x - meanA;
    const db = y - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
    used += 1;
  }
  if (used < 3 || denA <= 0 || denB <= 0) {
    return null;
  }
  return num / Math.sqrt(denA * denB);
}

/**
 * Cross-correlation of x and y at lag τ using Pearson correlation.
 * τ > 0: y is shifted forward (y[t+τ] paired with x[t]) → peaks at τ > 0 imply x leads y.
 * τ < 0: x is shifted forward relative to y.
 */
export function crossCorrAtLag(x: number[], y: number[], lag: number): number | null {
  if (lag >= 0) {
    const len = Math.min(x.length, y.length) - lag;
    if (len < 3) {
      return null;
    }
    const xs = x.slice(0, len);
    const ys = y.slice(lag, lag + len);
    return pearson(xs, ys);
  }
  const k = -lag;
  const len = Math.min(x.length, y.length) - k;
  if (len < 3) {
    return null;
  }
  const xs = x.slice(k, k + len);
  const ys = y.slice(0, len);
  return pearson(xs, ys);
}

export interface LagCorrelation {
  lag: number;
  correlation: number | null;
}

export function crossCorrSeries(x: number[], y: number[], maxLag: number): LagCorrelation[] {
  const out: LagCorrelation[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    out.push({ lag, correlation: crossCorrAtLag(x, y, lag) });
  }
  return out;
}

export function bestLag(series: LagCorrelation[]): { lag: number; correlation: number } | null {
  let best: { lag: number; correlation: number } | null = null;
  for (const entry of series) {
    if (entry.correlation === null) {
      continue;
    }
    if (best === null || Math.abs(entry.correlation) > Math.abs(best.correlation)) {
      best = { lag: entry.lag, correlation: entry.correlation };
    }
  }
  return best;
}

/** Inner-join bars on equal open time (ms). */
export function alignByTimestamp(
  left: OhlcvBar[],
  right: OhlcvBar[],
): {
  left: OhlcvBar[];
  right: OhlcvBar[];
  ts: number[];
} {
  const rightByTs = new Map<number, OhlcvBar>();
  for (const bar of right) {
    rightByTs.set(bar.ts, bar);
  }
  const outL: OhlcvBar[] = [];
  const outR: OhlcvBar[] = [];
  const ts: number[] = [];
  for (const bar of left) {
    const match = rightByTs.get(bar.ts);
    if (match !== undefined) {
      outL.push(bar);
      outR.push(match);
      ts.push(bar.ts);
    }
  }
  return { left: outL, right: outR, ts };
}
