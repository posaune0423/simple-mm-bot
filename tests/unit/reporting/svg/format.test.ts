import { describe, expect, test } from "bun:test";

import {
  autoNumberFormatter,
  autoTimeFormatter,
  compactCurrencyFormatter,
  decimalsFor,
  niceTimeTicks,
  pickTimeStep,
} from "../../../../src/lib/reporting/svg/format.ts";

describe("niceTimeTicks", () => {
  test("aligns ticks to hour boundaries inside the domain", () => {
    const start = Date.UTC(2026, 4, 6, 0, 13, 0);
    const end = Date.UTC(2026, 4, 6, 23, 47, 0);
    const ticks = niceTimeTicks({ min: start, max: end }, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    const formatted = new Set(ticks.map((t) => new Date(t).toISOString()));
    expect(formatted.size).toBe(ticks.length);
    for (const t of ticks) {
      const d = new Date(t);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });

  test("handles 7d span with daily-ish step", () => {
    const span = 7 * 24 * 60 * 60_000;
    const start = Date.UTC(2026, 4, 1, 0, 0, 0);
    const ticks = niceTimeTicks({ min: start, max: start + span }, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThan(20);
  });
});

describe("autoTimeFormatter", () => {
  test("includes date when domain >= 1 day", () => {
    const start = Date.UTC(2026, 4, 1, 0, 0, 0);
    const formatter = autoTimeFormatter({ min: start, max: start + 24 * 60 * 60_000 });
    expect(formatter(start)).toBe("05-01 00:00");
  });

  test("omits date when domain < 1 day", () => {
    const start = Date.UTC(2026, 4, 1, 8, 0, 0);
    const formatter = autoTimeFormatter({ min: start, max: start + 60 * 60_000 });
    expect(formatter(start)).toBe("08:00");
  });
});

describe("decimalsFor / autoNumberFormatter", () => {
  test("scales decimals to fit small spans", () => {
    expect(decimalsFor({ min: 0, max: 100 })).toBe(0);
    expect(decimalsFor({ min: 0, max: 1 })).toBe(1);
    expect(decimalsFor({ min: 0, max: 0.05 })).toBeGreaterThanOrEqual(2);
  });

  test("autoNumberFormatter applies suffix", () => {
    const fmt = autoNumberFormatter({ min: -0.05, max: 0.05 }, "bps");
    expect(fmt(0.04)).toMatch(/0\.04(.*)bps$/);
  });
});

describe("compactCurrencyFormatter", () => {
  test("formats thousands and millions", () => {
    expect(compactCurrencyFormatter(123)).toBe("$123");
    expect(compactCurrencyFormatter(1500)).toBe("$1.5k");
    expect(compactCurrencyFormatter(2_500_000)).toBe("$2.5M");
  });
});

describe("pickTimeStep", () => {
  test("returns at least the smallest step", () => {
    expect(pickTimeStep(0, 6)).toBe(60_000);
  });
});
