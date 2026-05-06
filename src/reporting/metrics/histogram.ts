export interface HistogramBin {
  lo: number;
  hi: number;
  count: number;
}

export function computeHistogram(values: ReadonlyArray<number>, binCount = 30): HistogramBin[] {
  if (values.length === 0 || binCount <= 0) return [];
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step = span / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, index) => ({
    lo: min + step * index,
    hi: min + step * (index + 1),
    count: 0,
  }));
  for (const value of values) {
    const rawIndex = Math.floor((value - min) / step);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    const bin = bins[index];
    if (bin !== undefined) bin.count += 1;
  }
  return bins;
}
