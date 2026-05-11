import { describe, expect, test } from "bun:test";

import { renderScatterChart } from "../../../../../src/lib/reporting/svg/charts/scatterChart.ts";

describe("renderScatterChart", () => {
  test("renders one circle per point", () => {
    const out = renderScatterChart(
      [
        { x: 100, y: 100 },
        { x: 101, y: 100.5 },
        { x: 102, y: 101.5 },
      ],
      { title: "Fill vs Mid", showDiagonal: true },
    );
    const circles = out.svg.match(/<circle/g) ?? [];
    expect(circles.length).toBe(3);
    expect(out.svg).toContain('stroke-dasharray="3 3"');
  });

  test("empty input returns placeholder", () => {
    const out = renderScatterChart([], {});
    expect(out.svg).toContain("No data");
  });
});
