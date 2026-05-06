import { describe, expect, test } from "bun:test";

import { renderMarkdownReport } from "../../../src/reporting/report/markdown.ts";

describe("renderMarkdownReport", () => {
  test("includes header, kpi table, and chart references", () => {
    const md = renderMarkdownReport({
      generatedAt: Date.UTC(2026, 4, 6, 12, 0, 0),
      mode: "live",
      venue: "hyperliquid",
      periods: [
        {
          label: "24h",
          metrics: {
            netPnl: 1,
            tradePnl: 1,
            markout5s: 0,
            markout30s: 0,
            maxDrawdown: 0,
            sharpe: 0,
            fillRate: 0.05,
          },
          fillAnalysis: { fillCount: 10, adverseSelectionCount: 1 },
        },
      ],
      sections: [
        {
          title: "Equity",
          charts: [{ alt: "Equity 24h", relativePath: "./charts/24h/equity.svg" }],
        },
      ],
      notes: ["smoke run"],
    });
    expect(md).toContain("# Bot Performance Report");
    expect(md).toContain("`2026-05-06T12:00:00.000Z`");
    expect(md).toContain("![Equity 24h](./charts/24h/equity.svg)");
    expect(md).toContain("- smoke run");
  });
});
