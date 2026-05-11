import { join } from "node:path";
import { ResultAsync } from "neverthrow";

import type { BucketEvidence } from "./evaluateLiveRun.ts";
import type { MetricsEvaluation } from "./lib/MetricsEvaluation.ts";
import type { TradingRunFact } from "../src/domain/ports/IMetricsRepository.ts";
import { LATEST_METRICS_EVALUATION_PATH, LATEST_METRICS_RESULTS_DIR } from "./lib/paths.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface EvaluationResult {
  run: TradingRunFact;
  evaluation: MetricsEvaluation;
  bucketEvidence?: BucketEvidence;
}

export function formatMetricsReportMarkdown(result: EvaluationResult): string {
  const { run, evaluation } = result;
  const quoteFreshness = evaluation.runtimeHealth.quoteFreshness;
  return [
    "# Metrics Run Report",
    "",
    `- Run: ${run.id}`,
    `- Mode: ${run.mode}`,
    `- Venue: ${run.venue}`,
    `- Capital mode: ${run.capitalMode}`,
    `- Market: ${run.market}`,
    `- Status: ${run.status}`,
    "",
    "## Data Health",
    "",
    `- Fill count: ${evaluation.dataHealth.fillCount}`,
    `- Markout coverage: ${(evaluation.dataHealth.markoutCoverage * 100).toFixed(1)}%`,
    `- Markout coverage 5s: ${formatCoverage(evaluation.dataHealth.markoutCoverageByHorizon["5s"])}`,
    `- Markout coverage 30s: ${formatCoverage(evaluation.dataHealth.markoutCoverageByHorizon["30s"])}`,
    `- Markout coverage 300s: ${formatCoverage(evaluation.dataHealth.markoutCoverageByHorizon["300s"])}`,
    `- Raw field coverage: ${(evaluation.dataHealth.rawFieldCoverage * 100).toFixed(1)}%`,
    `- Snapshot freshness ms: ${evaluation.dataHealth.snapshotFreshnessMs ?? "n/a"}`,
    "",
    "## PnL",
    "",
    `- Net PnL: ${evaluation.pnl.netPnl.toFixed(6)}`,
    `- Trade PnL: ${evaluation.pnl.tradePnl.toFixed(6)}`,
    `- Fee: ${evaluation.pnl.fee.toFixed(6)}`,
    `- Notional: ${formatNullableUsd(evaluation.pnl.notionalUsd)}`,
    `- Net EV: ${formatNullableBps(evaluation.pnl.netEvBps)}`,
    `- Trade EV: ${formatNullableBps(evaluation.pnl.tradeEvBps)}`,
    `- Fee/Rebate: ${formatNullableBps(evaluation.pnl.feeBps)}`,
    `- PnL per notional: ${evaluation.pnl.pnlPerNotional.toFixed(8)}`,
    `- PnL per volume: ${evaluation.pnl.pnlPerVolumeBps.toFixed(4)} bps`,
    `- Max drawdown: ${evaluation.pnl.maxDrawdown.toFixed(6)}`,
    "",
    "## Markout And Orders",
    "",
    `- Avg 5s markout: ${evaluation.markouts.avg5sBps.toFixed(4)} bps`,
    `- Avg 30s markout: ${formatNullableBps(evaluation.markouts.avg30sBps)}`,
    `- Avg 300s markout: ${formatNullableBps(evaluation.markouts.avg300sBps)}`,
    `- VW 5s markout: ${formatNullableBps(evaluation.markouts.vw5sBps)}`,
    `- VW 30s markout: ${formatNullableBps(evaluation.markouts.vw30sBps)}`,
    `- VW 300s markout: ${formatNullableBps(evaluation.markouts.vw300sBps)}`,
    `- 30s markout tail: p10=${evaluation.markouts.tail30sBps.p10.toFixed(4)} bps, p5=${evaluation.markouts.tail30sBps.p5.toFixed(4)} bps, p1=${formatNullableBps(evaluation.markouts.tail30sBps.p1 ?? null)}, worst=${evaluation.markouts.tail30sBps.worst.toFixed(4)} bps`,
    `- Adverse selection rate: ${(evaluation.markouts.adverseSelectionRate * 100).toFixed(1)}%`,
    `- Adverse selection 5s: ${(evaluation.markouts.adverseSelectionRate5s * 100).toFixed(1)}%`,
    `- Adverse selection 30s: ${formatNullablePercent(evaluation.markouts.adverseSelectionRate30s)}`,
    `- Adverse selection 300s: ${formatNullablePercent(evaluation.markouts.adverseSelectionRate300s)}`,
    `- Spread capture: ${evaluation.markouts.spreadCaptureBps.toFixed(4)} bps`,
    `- Realized spread: ${evaluation.markouts.realizedSpreadBps.toFixed(4)} bps`,
    `- Fill rate: ${(evaluation.orderQuality.fillRate * 100).toFixed(1)}%`,
    `- Side imbalance: ${(evaluation.orderQuality.sideImbalance * 100).toFixed(1)}%`,
    `- Reject rate: ${(evaluation.orderQuality.rejectRate * 100).toFixed(1)}%`,
    `- Cancel rate: ${(evaluation.orderQuality.cancelRate * 100).toFixed(1)}%`,
    `- Cancel before fill rate: ${(evaluation.orderQuality.cancelBeforeFillRate * 100).toFixed(1)}%`,
    `- Maker ratio: ${(evaluation.orderQuality.makerRatio * 100).toFixed(1)}%`,
    `- Avg latency: ${evaluation.orderQuality.avgLatencyMs.toFixed(2)} ms`,
    `- Avg order live time: ${evaluation.orderQuality.avgLiveMs.toFixed(2)} ms`,
    `- Avg quote age at fill: ${formatNullableMsFixed2(evaluation.orderQuality.avgQuoteAgeMs)}`,
    `- Market spread: ${evaluation.market.avgSpreadBps.toFixed(4)} bps`,
    `- Quote distance to mid: ${evaluation.market.avgQuoteDistanceToMidBps.toFixed(4)} bps`,
    `- Quote distance to best: ${evaluation.market.avgQuoteDistanceToBestBps.toFixed(4)} bps`,
    `- Stale rate: ${(evaluation.market.staleRate * 100).toFixed(1)}%`,
    "",
    "## Risk",
    "",
    `- Max abs position: ${formatNullableFixed6(evaluation.inventory.maxAbsPosition)}`,
    `- Avg abs position: ${formatNullableFixed6(evaluation.inventory.avgAbsPosition)}`,
    `- Position skew: ${evaluation.inventory.positionSkew.toFixed(6)}`,
    `- Reduce count: ${evaluation.inventory.reduceCount}`,
    `- Hard reduce count: ${evaluation.inventory.hardReduceCount}`,
    `- Min margin ratio: ${formatNullablePercent(evaluation.inventory.minMarginRatio)}`,
    "",
    "## Volume Pace",
    "",
    `- Current notional: ${formatNullableUsd(evaluation.volume.notionalUsd)}`,
    `- Phase1 required ${evaluation.volume.targetDays}d volume: ${evaluation.volume.requiredTargetUsd.toFixed(2)}`,
    `- Phase1 projected ${evaluation.volume.targetDays}d volume: ${formatNullableUsd(evaluation.volume.projectedTargetUsd)}`,
    `- Projected shortfall: ${formatNullableUsd(evaluation.volume.projectedShortfallUsd)}`,
    `- Required multiplier: ${formatNullableMultiplier(evaluation.volume.requiredMultiplier)}`,
    `- Required daily volume: ${evaluation.volume.requiredDailyUsd.toFixed(2)}`,
    `- Required hourly volume: ${(evaluation.volume.requiredDailyUsd / 24).toFixed(2)}`,
    `- Required minute volume: ${(evaluation.volume.requiredDailyUsd / 24 / 60).toFixed(2)}`,
    `- Balanced daily volume: ${evaluation.volume.balancedDailyUsd.toFixed(2)}`,
    `- Rebate reference ${evaluation.volume.rebateReferenceDays}d volume: ${evaluation.volume.rebateReferenceUsd.toFixed(2)}`,
    `- Rebate projected ${evaluation.volume.rebateReferenceDays}d volume: ${formatNullableUsd(evaluation.volume.projected14dUsd)}`,
    "",
    ...formatBucketEvidence(result.bucketEvidence),
    "",
    "## A-S Gate",
    "",
    `- Verdict: ${evaluation.verdict}`,
    `- Parameter action: ${evaluation.parameterAction}`,
    `- Pass net PnL: ${evaluation.passFail.netPnl}`,
    `- Pass PnL per volume: ${evaluation.passFail.pnlPerVolumeBps}`,
    `- Pass avg 30s markout: ${evaluation.passFail.avgMarkout30s}`,
    `- Pass markout tail: ${evaluation.passFail.markoutTail}`,
    `- Pass side imbalance: ${evaluation.passFail.sideImbalance}`,
    "",
    "## Runtime",
    "",
    `- Warnings: ${evaluation.runtimeHealth.warningCount}`,
    `- Errors: ${evaluation.runtimeHealth.errorCount}`,
    "",
    "## Quote Freshness",
    `- Samples: ${quoteFreshness.sampleCount}`,
    `- Total refresh ms: p50=${formatNullableFixed2(quoteFreshness.totalRefreshMsP50)} p95=${formatNullableFixed2(quoteFreshness.totalRefreshMsP95)} max=${formatNullableFixed2(quoteFreshness.totalRefreshMsMax)}`,
    `- Quality gate p95: ${formatNullableMs(quoteFreshness.qualityGateMsP95)}`,
    `- Record quote p95: ${formatNullableMs(quoteFreshness.recordQuoteMsP95)}`,
    `- Reconcile p95: ${formatNullableMs(quoteFreshness.reconcileMsP95)}`,
    `- Book age at decision p95: ${formatNullableMs(quoteFreshness.bookAgeMsAtDecisionP95)}`,
    `- Mid-move p95 abs: ${formatNullableBpsWithUnit(quoteFreshness.midMoveDuringRefreshBpsP95Abs)}`,
    `- Slow cycle rate: ${formatNullablePercentOrRatio(quoteFreshness.slowCycleRate)}`,
    "",
    `- Tuning allowed: ${evaluation.tuningAllowed}`,
    `- Issue signals: ${evaluation.issueSignals.join(", ") || "none"}`,
  ].join("\n");
}

function formatBucketEvidence(bucketEvidence: BucketEvidence | undefined): string[] {
  if (bucketEvidence === undefined) {
    return [];
  }
  return [
    "## Bucket Evidence",
    "",
    "### Side Intent",
    "",
    formatBucketTable(bucketEvidence.sideIntent),
    "",
    "### Quote Level",
    "",
    formatBucketTable(bucketEvidence.quoteLevel),
    "",
    "### Quote Age",
    "",
    formatBucketTable(bucketEvidence.quoteAge),
  ];
}

function formatBucketTable(rows: BucketEvidence["sideIntent"]): string {
  if (rows.length === 0) {
    return "No fills.";
  }
  return [
    "| bucket | fills | notional | vw mo 5s | vw mo 30s | p5 mo 30s | p1 mo 30s | net ev bps | avg 5s | avg 30s | adverse 5s | adverse 30s | live ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.bucket} | ${row.fillCount} | ${row.notionalUsd.toFixed(2)} | ${formatNullableNumber(row.vw5sMarkoutBps)} | ${formatNullableNumber(row.vw30sMarkoutBps)} | ${formatNullableNumber(row.p5Markout30sBps)} | ${formatNullableNumber(row.p1Markout30sBps)} | ${formatNullableNumber(row.pnlPerVolumeBps)} | ${formatNullableNumber(row.avg5sMarkoutBps)} | ${formatNullableNumber(row.avg30sMarkoutBps)} | ${formatNullablePercent(row.adverseSelectionRate5s)} | ${formatNullablePercent(row.adverseSelectionRate30s)} | ${formatNullableNumber(row.avgOrderLiveMs)} |`,
    ),
  ].join("\n");
}

function formatNullableUsd(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function formatNullableFixed2(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function formatNullableFixed6(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(6);
}

function formatNullableBpsWithUnit(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(4)} bps`;
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatNullableMs(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(0)} ms`;
}

function formatNullableMsFixed2(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)} ms`;
}

function formatNullableBps(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(4)} bps`;
}

function formatNullablePercentOrRatio(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatCoverage(value: { observed: number; total: number; coverage: number }): string {
  return `${(value.coverage * 100).toFixed(1)}% (${value.observed}/${value.total})`;
}

function formatNullableMultiplier(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)}x`;
}

function generate(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const evaluationPath = options.evaluation ?? LATEST_METRICS_EVALUATION_PATH;
  const outputDir = options["output-dir"] ?? LATEST_METRICS_RESULTS_DIR;

  return ResultAsync.fromPromise(
    (async () => {
      const result = (await Bun.file(evaluationPath).json()) as EvaluationResult;
      const reportPath = join(outputDir, "metrics-report.md");
      await Promise.all([
        writeTextFile(reportPath, formatMetricsReportMarkdown(result)),
        writeJsonFile(join(outputDir, "metrics-report.json"), result),
      ]);
      return reportPath;
    })(),
    (error) => createAppError("metrics.report_failed", "Failed to generate metrics report", error),
  );
}

if (import.meta.main) {
  void generate(Bun.argv.slice(2)).match(
    (reportPath) => logger.info(`metrics report written to ${reportPath}`),
    (error) => {
      logger.error(formatAppError(error));
      process.exitCode = 1;
    },
  );
}
