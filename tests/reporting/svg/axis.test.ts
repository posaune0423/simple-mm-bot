import { describe, expect, test } from "bun:test";

import { bandAxis, xAxis, yAxis } from "../../../src/lib/reporting/svg/axis.ts";
import { bandScale, linearScale } from "../../../src/lib/reporting/svg/scale.ts";

describe("xAxis", () => {
  test("renders baseline and tick labels", () => {
    const scale = linearScale({ min: 0, max: 100 }, { start: 0, end: 200 });
    const svg = xAxis({ scale, ticks: [0, 50, 100], y: 50, x0: 0, x1: 200 });
    expect(svg).toContain('<line x1="0" y1="50" x2="200" y2="50"');
    expect(svg).toContain(">0<");
    expect(svg).toContain(">50<");
    expect(svg).toContain(">100<");
  });
});

describe("yAxis", () => {
  test("optionally renders grid lines", () => {
    const scale = linearScale({ min: 0, max: 10 }, { start: 100, end: 0 });
    const svg = yAxis({
      scale,
      ticks: [0, 5, 10],
      x: 40,
      y0: 0,
      y1: 100,
      gridX0: 40,
      gridX1: 200,
    });
    expect(svg).toContain('stroke-dasharray="2 2"');
  });

  test("omits grid lines when grid bounds not provided", () => {
    const scale = linearScale({ min: 0, max: 10 }, { start: 100, end: 0 });
    const svg = yAxis({ scale, ticks: [0, 5, 10], x: 40, y0: 0, y1: 100 });
    expect(svg).not.toContain("stroke-dasharray");
  });
});

describe("bandAxis", () => {
  test("renders one label per category", () => {
    const scale = bandScale(["a", "b", "c"], { start: 0, end: 90 });
    const svg = bandAxis({ scale, y: 100, x0: 0, x1: 90 });
    expect((svg.match(/<text/g) ?? []).length).toBe(3);
  });

  test("respects every parameter for sparse labels", () => {
    const keys = Array.from({ length: 24 }, (_, i) => String(i));
    const scale = bandScale(keys, { start: 0, end: 240 });
    const svg = bandAxis({ scale, y: 0, x0: 0, x1: 240, every: 6 });
    expect((svg.match(/<text/g) ?? []).length).toBe(4);
  });
});
