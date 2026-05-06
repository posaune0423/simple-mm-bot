import { describe, expect, test } from "bun:test";

import { renderKpiTable } from "../../../src/reporting/report/kpiTable.ts";

describe("renderKpiTable", () => {
  test("emits a markdown table with one column per period", () => {
    const md = renderKpiTable([
      {
        label: "24h",
        metrics: {
          netPnl: 1.2345,
          tradePnl: 1.5,
          markout5s: 0.5,
          markout30s: 0.8,
          maxDrawdown: 0.3,
          sharpe: 1.234,
          fillRate: 0.123,
        },
        fillAnalysis: { fillCount: 100, adverseSelectionCount: 25 },
      },
      {
        label: "7d",
        metrics: {
          netPnl: 7,
          tradePnl: 8,
          markout5s: 1.2,
          markout30s: 1.4,
          maxDrawdown: 1.1,
          sharpe: 0.9,
          fillRate: 0.08,
        },
        fillAnalysis: { fillCount: 700, adverseSelectionCount: 200 },
      },
    ]);
    expect(md).toContain("| Metric | 24h | 7d |");
    expect(md).toContain("| Net PnL | 1.2345 | 7.0000 |");
    expect(md).toContain("Adverse Selection");
    expect(md).toContain("25.00%");
  });

  test("returns empty string when no periods", () => {
    expect(renderKpiTable([])).toBe("");
  });
});
