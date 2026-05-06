import type { Domain } from "./scale.ts";

const TIME_STEPS_MS: ReadonlyArray<number> = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
  2 * 24 * 60 * 60_000,
  7 * 24 * 60 * 60_000,
];

export function pickTimeStep(spanMs: number, count: number): number {
  const target = spanMs / Math.max(1, count);
  for (const step of TIME_STEPS_MS) {
    if (step >= target) return step;
  }
  return TIME_STEPS_MS[TIME_STEPS_MS.length - 1] ?? 24 * 60 * 60_000;
}

export function niceTimeTicks(domain: Domain, count = 6): number[] {
  if (domain.min === domain.max) return [domain.min];
  const step = pickTimeStep(domain.max - domain.min, count);
  const start = Math.ceil(domain.min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= domain.max + step * 1e-6; value += step) {
    ticks.push(value);
  }
  return ticks;
}

export function autoTimeFormatter(domain: Domain): (ms: number) => string {
  const spanMs = domain.max - domain.min;
  const oneDay = 24 * 60 * 60_000;
  const showDate = spanMs >= oneDay;
  return (ms) => {
    const date = new Date(ms);
    const month = pad2(date.getUTCMonth() + 1);
    const day = pad2(date.getUTCDate());
    const hour = pad2(date.getUTCHours());
    const minute = pad2(date.getUTCMinutes());
    return showDate ? `${month}-${day} ${hour}:${minute}` : `${hour}:${minute}`;
  };
}

export function decimalsFor(domain: Domain): number {
  const span = Math.abs(domain.max - domain.min);
  if (!Number.isFinite(span) || span === 0) return 2;
  const target = span / 5;
  const decimals = Math.ceil(-Math.log10(target));
  return Math.max(0, Math.min(6, decimals));
}

export function autoNumberFormatter(domain: Domain, suffix = ""): (value: number) => string {
  const decimals = decimalsFor(domain);
  return (value) => `${value.toFixed(decimals)}${suffix}`;
}

export function compactCurrencyFormatter(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
