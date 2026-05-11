import { describe, expect, test } from "bun:test";

import { renderKpiTable } from "../../../src/lib/reporting/report/kpiTable.ts";

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
          notionalUsd: 10_000,
          netEvBps: 1.2345,
          feeBps: 0.2,
          vwMarkout5sBps: 0.5,
          vwMarkout30sBps: 0.8,
          p5Markout30sBps: -2,
          p1Markout30sBps: -4,
          markoutCoverage: 0.9,
          makerRatio: 0.8,
          avgQuoteAgeMs: 250,
          maxAbsPosition: 0.4,
          reduceCount: 2,
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
          notionalUsd: 20_000,
          netEvBps: 3.5,
          feeBps: 0.15,
          vwMarkout5sBps: 1.2,
          vwMarkout30sBps: 1.4,
          p5Markout30sBps: -1,
          p1Markout30sBps: -3,
          markoutCoverage: 0.95,
          makerRatio: 0.9,
          avgQuoteAgeMs: 300,
          maxAbsPosition: 0.5,
          reduceCount: 3,
          maxDrawdown: 1.1,
          sharpe: 0.9,
          fillRate: 0.08,
        },
        fillAnalysis: { fillCount: 700, adverseSelectionCount: 200 },
      },
    ]);
    expect(md).toContain("| Metric | 24h | 7d |");
    expect(md).toContain("### Performance");
    expect(md).toContain("### Fill Quality");
    expect(md).toContain("### Execution-Risk");
    expect(md).toContain("| Net PnL | 1.2345 | 7.0000 |");
    expect(md).toContain("| Net EV bps | 1.2345 | 3.5000 |");
    expect(md).toContain("| VW Markout 30s | 0.8000 | 1.4000 |");
    expect(md).toContain("| Markout Coverage | 90.00% | 95.00% |");
    expect(md).toContain("| Maker Ratio | 80.00% | 90.00% |");
    expect(md).toContain("| Avg Quote Age @ Fill | 250.00 ms | 300.00 ms |");
    expect(md).toContain("| Max Abs Position | 0.4000 | 0.5000 |");
    expect(md).toContain("| Reduce Count | 2 | 3 |");
    expect(md).not.toContain("Markout 5s (sum)");
    expect(md).toContain("Adverse Selection");
    expect(md).toContain("25.00%");
  });

  test("returns empty string when no periods", () => {
    expect(renderKpiTable([])).toBe("");
  });
});
