export interface Domain {
  readonly min: number;
  readonly max: number;
}

interface Range {
  readonly start: number;
  readonly end: number;
}

export interface LinearScale {
  readonly domain: Domain;
  readonly range: Range;
  (value: number): number;
}

export function linearScale(domain: Domain, range: Range): LinearScale {
  const span = domain.max - domain.min;
  const safeSpan = span === 0 ? 1 : span;
  const fn = ((value: number) => {
    const t = (value - domain.min) / safeSpan;
    return range.start + t * (range.end - range.start);
  }) as LinearScale;
  Object.assign(fn, { domain, range });
  return fn;
}

export interface BandScale {
  readonly domain: ReadonlyArray<string>;
  readonly range: Range;
  readonly bandwidth: number;
  (key: string): number;
}

export function bandScale(domain: ReadonlyArray<string>, range: Range, padding = 0.1): BandScale {
  const span = range.end - range.start;
  const step = domain.length > 0 ? span / domain.length : span;
  const bandwidth = Math.max(0, step * (1 - padding));
  const offset = (step - bandwidth) / 2;
  const lookup = new Map<string, number>();
  for (let i = 0; i < domain.length; i += 1) {
    const key = domain[i];
    if (key === undefined) continue;
    lookup.set(key, range.start + step * i + offset);
  }
  const fn = ((key: string) => {
    const value = lookup.get(key);
    if (value === undefined) {
      throw new Error(`bandScale: unknown key ${key}`);
    }
    return value;
  }) as BandScale;
  Object.assign(fn, { domain, range, bandwidth });
  return fn;
}

export function niceTicks(domain: Domain, count = 5): number[] {
  if (count <= 0) return [];
  if (domain.min === domain.max) return [domain.min];
  const span = domain.max - domain.min;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rawStep)));
  const candidates = [1, 2, 2.5, 5, 10];
  let step = magnitude;
  for (const candidate of candidates) {
    if (candidate * magnitude >= rawStep) {
      step = candidate * magnitude;
      break;
    }
  }
  const start = Math.ceil(domain.min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= domain.max + step * 1e-9; value += step) {
    ticks.push(roundToStep(value, step));
  }
  return ticks;
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number(value.toFixed(Math.min(12, decimals + 2)));
}

export function extent(values: ReadonlyArray<number>): Domain {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 1;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

export function symmetricExtent(values: ReadonlyArray<number>): Domain {
  const base = extent(values);
  const magnitude = Math.max(Math.abs(base.min), Math.abs(base.max));
  return { min: -magnitude, max: magnitude };
}
