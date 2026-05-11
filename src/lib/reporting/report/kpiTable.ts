import type { ReportFillAnalysis, ReportPerformanceMetrics } from "../types.ts";

export interface PeriodKpis {
  label: string;
  metrics: ReportPerformanceMetrics;
  fillAnalysis: ReportFillAnalysis;
}

function formatNumber(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(fractionDigits);
}

function formatPct(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

function formatNullableNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toFixed(fractionDigits);
}

function formatNullablePct(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

function formatNullableMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)} ms`;
}

function adverseRate(analysis: ReportFillAnalysis): number {
  return analysis.fillCount > 0 ? analysis.adverseSelectionCount / analysis.fillCount : 0;
}

export function renderKpiTable(periods: ReadonlyArray<PeriodKpis>): string {
  if (periods.length === 0) return "";
  const headers = ["Metric", ...periods.map((p) => p.label)];
  const sections: ReadonlyArray<{
    title: string;
    rows: ReadonlyArray<readonly [string, (p: PeriodKpis) => string]>;
  }> = [
    {
      title: "Performance",
      rows: [
        ["Notional", (p) => formatNullableNumber(p.metrics.notionalUsd, 2)],
        ["Net PnL", (p) => formatNumber(p.metrics.netPnl, 4)],
        ["Trade PnL", (p) => formatNumber(p.metrics.tradePnl, 4)],
        ["Net EV bps", (p) => formatNullableNumber(p.metrics.netEvBps, 4)],
        ["Fee/Rebate bps", (p) => formatNullableNumber(p.metrics.feeBps, 4)],
        ["Max Drawdown", (p) => formatNumber(p.metrics.maxDrawdown, 4)],
        ["Sharpe", (p) => formatNumber(p.metrics.sharpe, 3)],
      ],
    },
    {
      title: "Fill Quality",
      rows: [
        ["VW Markout 5s", (p) => formatNullableNumber(p.metrics.vwMarkout5sBps, 4)],
        ["VW Markout 30s", (p) => formatNullableNumber(p.metrics.vwMarkout30sBps, 4)],
        ["P5 Markout 30s", (p) => formatNullableNumber(p.metrics.p5Markout30sBps, 4)],
        ["P1 Markout 30s", (p) => formatNullableNumber(p.metrics.p1Markout30sBps, 4)],
        ["Markout Coverage", (p) => formatNullablePct(p.metrics.markoutCoverage)],
        ["Fill Count", (p) => String(p.fillAnalysis.fillCount)],
        ["Fill Rate", (p) => formatPct(p.metrics.fillRate)],
        ["Adverse Selection", (p) => formatPct(adverseRate(p.fillAnalysis))],
      ],
    },
    {
      title: "Execution-Risk",
      rows: [
        ["Maker Ratio", (p) => formatNullablePct(p.metrics.makerRatio)],
        ["Avg Quote Age @ Fill", (p) => formatNullableMs(p.metrics.avgQuoteAgeMs)],
        ["Max Abs Position", (p) => formatNullableNumber(p.metrics.maxAbsPosition, 4)],
        ["Reduce Count", (p) => String(p.metrics.reduceCount ?? 0)],
      ],
    },
  ];

  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`### ${section.title}`);
    lines.push("");
    lines.push(`| ${headers.join(" | ")} |`);
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
    for (const [label, render] of section.rows) {
      lines.push(`| ${label} | ${periods.map((p) => render(p)).join(" | ")} |`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
