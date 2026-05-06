import type { FillAnalysis, PerformanceMetrics } from "../../domain/entities/PerformanceMetrics.ts";

export interface PeriodKpis {
  label: string;
  metrics: PerformanceMetrics;
  fillAnalysis: FillAnalysis;
}

function formatNumber(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(fractionDigits);
}

function formatPct(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

function adverseRate(analysis: FillAnalysis): number {
  return analysis.fillCount > 0 ? analysis.adverseSelectionCount / analysis.fillCount : 0;
}

export function renderKpiTable(periods: ReadonlyArray<PeriodKpis>): string {
  if (periods.length === 0) return "";
  const headers = ["Metric", ...periods.map((p) => p.label)];
  const rows: ReadonlyArray<readonly [string, (p: PeriodKpis) => string]> = [
    ["Net PnL", (p) => formatNumber(p.metrics.netPnl, 4)],
    ["Trade PnL", (p) => formatNumber(p.metrics.tradePnl, 4)],
    ["Markout 5s (sum)", (p) => formatNumber(p.metrics.markout5s, 4)],
    ["Markout 30s (sum)", (p) => formatNumber(p.metrics.markout30s, 4)],
    ["Max Drawdown", (p) => formatNumber(p.metrics.maxDrawdown, 4)],
    ["Sharpe", (p) => formatNumber(p.metrics.sharpe, 3)],
    ["Fill Rate", (p) => formatPct(p.metrics.fillRate)],
    ["Fill Count", (p) => String(p.fillAnalysis.fillCount)],
    ["Adverse Selection", (p) => formatPct(adverseRate(p.fillAnalysis))],
  ];

  const lines: string[] = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const [label, render] of rows) {
    lines.push(`| ${label} | ${periods.map((p) => render(p)).join(" | ")} |`);
  }
  return lines.join("\n");
}
