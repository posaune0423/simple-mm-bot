import { describe, expect, test } from "bun:test";

import { renderLineChart } from "../../../../../src/lib/reporting/svg/charts/lineChart.ts";

describe("renderLineChart", () => {
  test("returns valid svg with polyline for non-empty data", () => {
    const out = renderLineChart(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 4 },
      ],
      { title: "Equity", yLabel: "USD" },
    );
    expect(out.svg.startsWith("<svg")).toBe(true);
    expect(out.svg.endsWith("</svg>")).toBe(true);
    expect(out.svg).toContain("<polyline");
    expect(out.svg).toContain("Equity");
  });

  test("renders fallback for empty data", () => {
    const out = renderLineChart([], { title: "Equity" });
    expect(out.svg).toContain("No data");
  });

  test("fillBelowBaseline produces a filled path", () => {
    const out = renderLineChart(
      [
        { x: 0, y: 0 },
        { x: 1, y: -1 },
        { x: 2, y: -2 },
      ],
      { fillBelowBaseline: true, fillColor: "#fca5a5", zeroBaseline: true },
    );
    expect(out.svg).toContain('fill="#fca5a5"');
  });
});
