import { describe, expect, test } from "bun:test";

import { renderBarChart } from "../../../../src/reporting/svg/charts/barChart.ts";

describe("renderBarChart", () => {
  test("renders vertical bars with positive/negative coloring", () => {
    const out = renderBarChart(
      [
        { category: "0", value: 1.2 },
        { category: "1", value: -0.4 },
      ],
      { title: "Markout/h", positiveColor: "#16a34a", negativeColor: "#dc2626" },
    );
    expect(out.svg).toContain('fill="#16a34a"');
    expect(out.svg).toContain('fill="#dc2626"');
  });

  test("renders horizontal layout when requested", () => {
    const out = renderBarChart(
      [
        { category: "ETH", value: 1000 },
        { category: "BTC", value: 500 },
      ],
      { horizontal: true, title: "Volume" },
    );
    expect(out.svg).toContain(">ETH<");
    expect(out.svg).toContain(">BTC<");
  });

  test("empty data falls back to placeholder", () => {
    const out = renderBarChart([], { title: "x" });
    expect(out.svg).toContain("No data");
  });
});
