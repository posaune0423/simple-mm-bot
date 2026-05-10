import { describe, expect, test } from "bun:test";

import { renderGroupedBarChart } from "../../../../src/lib/reporting/svg/charts/groupedBarChart.ts";

describe("renderGroupedBarChart", () => {
  test("renders bars per series and a legend entry", () => {
    const out = renderGroupedBarChart(
      ["00", "01", "02"],
      [
        { name: "buy", color: "#16a34a", values: [3, 1, 2] },
        { name: "sell", color: "#dc2626", values: [2, 4, 1] },
      ],
      { title: "Fills" },
    );
    expect(out.svg).toContain(">buy<");
    expect(out.svg).toContain(">sell<");
  });

  test("empty input returns placeholder", () => {
    const out = renderGroupedBarChart([], [], {});
    expect(out.svg).toContain("No data");
  });
});
