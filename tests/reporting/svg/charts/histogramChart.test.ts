import { describe, expect, test } from "bun:test";

import { computeHistogram } from "../../../../src/lib/reporting/metrics/histogram.ts";
import { renderHistogramChart } from "../../../../src/lib/reporting/svg/charts/histogramChart.ts";

describe("renderHistogramChart", () => {
  test("renders one rect per non-zero bin", () => {
    const bins = computeHistogram([0, 1, 2, 3, 4, 5], 5);
    const out = renderHistogramChart(bins, { title: "Markout" });
    expect(out.svg).toContain("<rect");
    expect(out.svg).toContain("Markout");
  });

  test("returns empty fallback for no bins", () => {
    const out = renderHistogramChart([], { title: "Markout" });
    expect(out.svg).toContain("No data");
  });
});
