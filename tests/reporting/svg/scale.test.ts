import { describe, expect, test } from "bun:test";

import {
  bandScale,
  extent,
  linearScale,
  niceTicks,
  symmetricExtent,
} from "../../../src/reporting/svg/scale.ts";

describe("linearScale", () => {
  test("maps domain edges to range edges", () => {
    const scale = linearScale({ min: 0, max: 100 }, { start: 0, end: 200 });
    expect(scale(0)).toBe(0);
    expect(scale(100)).toBe(200);
    expect(scale(50)).toBe(100);
  });

  test("collapsed domain maps to range start without dividing by zero", () => {
    const scale = linearScale({ min: 5, max: 5 }, { start: 0, end: 100 });
    expect(scale(5)).toBe(0);
  });
});

describe("bandScale", () => {
  test("places each key at evenly spaced offsets with padding", () => {
    const scale = bandScale(["a", "b", "c"], { start: 0, end: 90 }, 0);
    expect(scale("a")).toBeCloseTo(0);
    expect(scale("b")).toBeCloseTo(30);
    expect(scale("c")).toBeCloseTo(60);
    expect(scale.bandwidth).toBeCloseTo(30);
  });

  test("throws for unknown key", () => {
    const scale = bandScale(["a"], { start: 0, end: 10 });
    expect(() => scale("z")).toThrow();
  });
});

describe("niceTicks", () => {
  test("produces evenly spaced round ticks within the domain", () => {
    const ticks = niceTicks({ min: 0, max: 100 }, 5);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  test("handles negative ranges with a sensible step", () => {
    const ticks = niceTicks({ min: -50, max: 50 }, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks[0]).toBeGreaterThanOrEqual(-50);
    expect(ticks[0]).toBeLessThan(0);
    expect(ticks.at(-1)).toBeGreaterThan(0);
    expect(ticks.at(-1)).toBeLessThanOrEqual(50);
  });

  test("returns single value when domain collapses", () => {
    expect(niceTicks({ min: 7, max: 7 }, 5)).toEqual([7]);
  });
});

describe("extent / symmetricExtent", () => {
  test("extent returns min/max with padding when collapsed", () => {
    expect(extent([1, 5, 3])).toEqual({ min: 1, max: 5 });
    const collapsed = extent([2, 2, 2]);
    expect(collapsed.min).toBeLessThan(2);
    expect(collapsed.max).toBeGreaterThan(2);
  });

  test("symmetricExtent centres domain on zero", () => {
    expect(symmetricExtent([-1, 4])).toEqual({ min: -4, max: 4 });
  });
});
