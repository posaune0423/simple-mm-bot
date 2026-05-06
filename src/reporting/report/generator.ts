import { Analytics } from "../../domain/Analytics.ts";
import type { Fill } from "../../domain/entities/Fill.ts";
import { writeTextFile } from "../../utils/fs.ts";
import { computeHourlyAdverseRate } from "../metrics/adverseRate.ts";
import { computeDrawdown } from "../metrics/drawdown.ts";
import { computeHistogram } from "../metrics/histogram.ts";
import { computeHourlyMarkoutBps, computeHourlySideCounts } from "../metrics/hourlyBucket.ts";
import { computeFeeVsPnl, computeMarketVolume } from "../metrics/marketVolume.ts";
import { computeRollingSharpe } from "../metrics/rollingSharpe.ts";
import { compactCurrencyFormatter } from "../svg/format.ts";
import { renderAreaChart } from "../svg/charts/areaChart.ts";
import { renderBarChart } from "../svg/charts/barChart.ts";
import { renderGroupedBarChart } from "../svg/charts/groupedBarChart.ts";
import { renderHistogramChart } from "../svg/charts/histogramChart.ts";
import { renderLineChart } from "../svg/charts/lineChart.ts";
import { renderScatterChart } from "../svg/charts/scatterChart.ts";
import { theme } from "../svg/theme.ts";
import type { ReportSection } from "./markdown.ts";
import { renderMarkdownReport } from "./markdown.ts";
import type { PeriodKpis } from "./kpiTable.ts";
import {
  chartFilePath,
  chartRelativeFromDateReport,
  chartRelativeFromLatest,
  reportPaths,
  snapshotDateFromMs,
} from "./paths.ts";
import { join } from "node:path";

export interface PeriodWindow {
  key: string;
  label: string;
  durationMs: number;
}

interface GenerateReportInput {
  fetchFills: (input: {
    venue?: string;
    periodStart: number;
    periodEnd: number;
  }) => Promise<Fill[]>;
  now: number;
  mode: string;
  venue?: string;
  outputDir: string;
  periods: ReadonlyArray<PeriodWindow>;
  notes?: ReadonlyArray<string>;
}

interface GenerateReportOutput {
  latestMd: string;
  historyMd: string;
  chartFiles: string[];
}

interface ChartSpec {
  tier: 1 | 2 | 3;
  chartId: string;
  alt: string;
  svg: string;
}

interface PeriodArtifacts {
  period: PeriodWindow;
  kpis: PeriodKpis;
  charts: ChartSpec[];
}

export async function generateReport(input: GenerateReportInput): Promise<GenerateReportOutput> {
  const snapshotDate = snapshotDateFromMs(input.now);
  const paths = reportPaths(input.outputDir, snapshotDate);
  const analytics = new Analytics();

  const periodArtifacts: PeriodArtifacts[] = [];
  for (const period of input.periods) {
    const periodEnd = input.now;
    const periodStart = input.now - period.durationMs;
    const fills = await input.fetchFills({ venue: input.venue, periodStart, periodEnd });
    const built = analytics.build({ fills, quotedCount: fills.length });
    const kpis: PeriodKpis = {
      label: period.label,
      metrics: built.metrics,
      fillAnalysis: built.fillAnalysis,
    };
    const charts = buildPeriodCharts({ period, fills, equityCurve: built.equityCurve });
    periodArtifacts.push({ period, kpis, charts });
  }

  const chartFiles: string[] = [];
  for (const entry of periodArtifacts) {
    for (const chart of entry.charts) {
      const filePath = chartFilePath(
        input.outputDir,
        snapshotDate,
        entry.period.key,
        chart.chartId,
      );
      await writeTextFile(filePath, chart.svg);
      chartFiles.push(filePath);
    }
  }

  const latestSections = buildSections(periodArtifacts, (period, chartId) =>
    chartRelativeFromLatest(snapshotDate, period.key, chartId),
  );
  const dateSections = buildSections(periodArtifacts, (period, chartId) =>
    chartRelativeFromDateReport(period.key, chartId),
  );

  const periods = periodArtifacts.map((entry) => entry.kpis);

  const latestMd = renderMarkdownReport({
    generatedAt: input.now,
    mode: input.mode,
    venue: input.venue ?? "all",
    periods,
    sections: latestSections,
    notes: input.notes,
  });
  const dateMd = renderMarkdownReport({
    generatedAt: input.now,
    mode: input.mode,
    venue: input.venue ?? "all",
    periods,
    sections: dateSections,
    notes: input.notes,
  });

  await writeTextFile(paths.latestMd, latestMd);
  await writeTextFile(paths.reportMd, dateMd);

  return {
    latestMd: paths.latestMd,
    historyMd: paths.reportMd,
    chartFiles,
  };
}

function buildSections(
  periodArtifacts: ReadonlyArray<PeriodArtifacts>,
  resolvePath: (period: PeriodWindow, chartId: string) => string,
): ReportSection[] {
  const sections: ReportSection[] = [];
  for (const entry of periodArtifacts) {
    const tiered: Record<1 | 2 | 3, Array<{ alt: string; relativePath: string }>> = {
      1: [],
      2: [],
      3: [],
    };
    for (const chart of entry.charts) {
      tiered[chart.tier].push({
        alt: `${chart.alt} (${entry.period.label})`,
        relativePath: resolvePath(entry.period, chart.chartId),
      });
    }
    if (tiered[1].length > 0) {
      sections.push({ title: `Tier 1 — Core (${entry.period.label})`, charts: tiered[1] });
    }
    if (tiered[2].length > 0) {
      sections.push({ title: `Tier 2 — Execution (${entry.period.label})`, charts: tiered[2] });
    }
    if (tiered[3].length > 0) {
      sections.push({
        title: `Tier 3 — Supplementary (${entry.period.label})`,
        charts: tiered[3],
      });
    }
  }
  return sections;
}

interface BuildPeriodChartsArgs {
  period: PeriodWindow;
  fills: ReadonlyArray<Fill>;
  equityCurve: ReadonlyArray<{ timestamp: number; value: number }>;
}

function buildPeriodCharts(args: BuildPeriodChartsArgs): ChartSpec[] {
  const { period, fills, equityCurve } = args;
  const out: ChartSpec[] = [];

  const equity = renderLineChart(
    equityCurve.map((p) => ({ x: p.timestamp, y: p.value })),
    {
      title: `Equity Curve (${period.label})`,
      yLabel: "Cumulative Net PnL",
      xType: "time",
      zeroBaseline: true,
    },
  );
  out.push({ tier: 1, chartId: "equity", alt: "Equity Curve", svg: equity.svg });

  const drawdown = computeDrawdown(equityCurve);
  const drawdownChart = renderAreaChart(
    drawdown.map((p) => ({ x: p.timestamp, y: p.drawdown })),
    {
      title: `Drawdown (${period.label})`,
      yLabel: "Underwater",
      xType: "time",
    },
  );
  out.push({ tier: 1, chartId: "drawdown", alt: "Drawdown", svg: drawdownChart.svg });

  const markout5sValues = collectMarkoutBps(fills, "5s");
  const markout5sChart = renderHistogramChart(computeHistogram(markout5sValues, 30), {
    title: `Markout 5s Distribution (${period.label})`,
    xSuffix: " bps",
  });
  out.push({
    tier: 1,
    chartId: "markout-5s-hist",
    alt: "Markout 5s Distribution",
    svg: markout5sChart.svg,
  });

  const markout30sValues = collectMarkoutBps(fills, "30s");
  const markout30sChart = renderHistogramChart(computeHistogram(markout30sValues, 30), {
    title: `Markout 30s Distribution (${period.label})`,
    xSuffix: " bps",
  });
  out.push({
    tier: 1,
    chartId: "markout-30s-hist",
    alt: "Markout 30s Distribution",
    svg: markout30sChart.svg,
  });

  const hourlyMarkout = computeHourlyMarkoutBps(fills, "5s");
  const hourlyMarkoutChart = renderBarChart(
    hourlyMarkout.map((b) => ({ category: pad2(b.hour), value: b.markoutBpsAvg })),
    {
      title: `Hourly Markout 5s bps (${period.label})`,
      positiveColor: theme.colors.positive,
      negativeColor: theme.colors.negative,
      every: 3,
    },
  );
  out.push({
    tier: 1,
    chartId: "hourly-markout",
    alt: "Hourly Markout (5s, bps)",
    svg: hourlyMarkoutChart.svg,
  });

  const tradePnlValues = fills.map((f) => f.tradePnl);
  const tradePnlChart = renderHistogramChart(computeHistogram(tradePnlValues, 30), {
    title: `Trade PnL Distribution (${period.label})`,
  });
  out.push({
    tier: 2,
    chartId: "trade-pnl-hist",
    alt: "Trade PnL Distribution",
    svg: tradePnlChart.svg,
  });

  const adverseHourly = computeHourlyAdverseRate(fills);
  const adverseChart = renderBarChart(
    adverseHourly.map((b) => ({ category: pad2(b.hour), value: b.adverseRate })),
    {
      title: `Adverse Selection Rate by Hour (${period.label})`,
      formatY: (v) => `${(v * 100).toFixed(0)}%`,
      color: theme.colors.negative,
      every: 3,
    },
  );
  out.push({
    tier: 2,
    chartId: "adverse-rate",
    alt: "Adverse Selection Rate",
    svg: adverseChart.svg,
  });

  const sideCounts = computeHourlySideCounts(fills);
  const fillCountChart = renderGroupedBarChart(
    sideCounts.map((b) => pad2(b.hour)),
    [
      { name: "buy", color: theme.colors.buy, values: sideCounts.map((b) => b.buy) },
      { name: "sell", color: theme.colors.sell, values: sideCounts.map((b) => b.sell) },
    ],
    {
      title: `Fill Count by Hour (${period.label})`,
      formatY: (v) => v.toFixed(0),
      every: 3,
    },
  );
  out.push({
    tier: 2,
    chartId: "fill-count",
    alt: "Fill Count (Buy/Sell)",
    svg: fillCountChart.svg,
  });

  const feeVsPnl = computeFeeVsPnl(fills);
  const feeVsPnlChart = renderGroupedBarChart(
    feeVsPnl.map((b) => pad2(b.hour)),
    [
      { name: "tradePnl", color: theme.colors.pnl, values: feeVsPnl.map((b) => b.tradePnl) },
      { name: "fee", color: theme.colors.fee, values: feeVsPnl.map((b) => b.fee) },
    ],
    {
      title: `Fee vs Trade PnL by Hour (${period.label})`,
      every: 3,
    },
  );
  out.push({
    tier: 2,
    chartId: "fee-vs-pnl",
    alt: "Fee vs Trade PnL",
    svg: feeVsPnlChart.svg,
  });

  if (period.key === "7d") {
    const sharpe = computeRollingSharpe(fills, Math.min(60, Math.max(2, fills.length)));
    const sharpeChart = renderLineChart(
      sharpe.map((p) => ({ x: p.timestamp, y: p.sharpe })),
      {
        title: `Rolling Sharpe (${period.label})`,
        yLabel: "Sharpe",
        xType: "time",
        zeroBaseline: true,
      },
    );
    out.push({
      tier: 3,
      chartId: "rolling-sharpe",
      alt: "Rolling Sharpe",
      svg: sharpeChart.svg,
    });
  }

  const marketVolume = computeMarketVolume(fills);
  const marketVolumeChart = renderBarChart(
    marketVolume.map((m) => ({ category: m.market, value: m.notional })),
    {
      title: `Market Notional Volume (${period.label})`,
      formatY: compactCurrencyFormatter,
      horizontal: true,
      color: theme.colors.primary,
    },
  );
  out.push({
    tier: 3,
    chartId: "market-volume",
    alt: "Market Volume",
    svg: marketVolumeChart.svg,
  });

  if (period.key === "24h") {
    const scatterChart = renderScatterChart(
      fills
        .filter((f) => f.markPriceAtFill !== undefined)
        .map((f) => ({ x: f.markPriceAtFill ?? 0, y: f.price })),
      {
        title: `Fill Price vs Mid (${period.label})`,
        showDiagonal: true,
      },
    );
    out.push({
      tier: 3,
      chartId: "price-vs-mid",
      alt: "Fill Price vs Mid",
      svg: scatterChart.svg,
    });
  }

  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function collectMarkoutBps(fills: ReadonlyArray<Fill>, horizon: "5s" | "30s"): number[] {
  const values: number[] = [];
  for (const fill of fills) {
    const future = horizon === "5s" ? fill.markPrice5s : fill.markPrice30s;
    if (fill.markPriceAtFill === undefined || future === undefined || fill.markPriceAtFill === 0)
      continue;
    const delta =
      fill.side === "buy" ? future - fill.markPriceAtFill : fill.markPriceAtFill - future;
    values.push((delta / fill.markPriceAtFill) * 10_000);
  }
  return values;
}

export const DEFAULT_PERIODS: PeriodWindow[] = [
  { key: "24h", label: "24h", durationMs: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7d", durationMs: 7 * 24 * 60 * 60 * 1000 },
];

export function defaultOutputDir(): string {
  return join("docs", "reports");
}
