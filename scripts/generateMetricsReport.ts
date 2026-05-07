import { join } from "node:path";
import { ResultAsync } from "neverthrow";

import type { MetricsEvaluation } from "./lib/MetricsEvaluation.ts";
import type { TradingRunFact } from "../src/infrastructure/Metrics.ts";
import { LATEST_METRICS_EVALUATION_PATH, LATEST_METRICS_RESULTS_DIR } from "../src/runtimePaths.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface EvaluationResult {
  run: TradingRunFact;
  evaluation: MetricsEvaluation;
}

function markdown(result: EvaluationResult): string {
  const { run, evaluation } = result;
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
    `- Raw field coverage: ${(evaluation.dataHealth.rawFieldCoverage * 100).toFixed(1)}%`,
    `- Snapshot freshness ms: ${evaluation.dataHealth.snapshotFreshnessMs ?? "n/a"}`,
    "",
    "## PnL",
    "",
    `- Net PnL: ${evaluation.pnl.netPnl.toFixed(6)}`,
    `- Trade PnL: ${evaluation.pnl.tradePnl.toFixed(6)}`,
    `- Fee: ${evaluation.pnl.fee.toFixed(6)}`,
    `- PnL per notional: ${evaluation.pnl.pnlPerNotional.toFixed(8)}`,
    `- PnL per volume: ${evaluation.pnl.pnlPerVolumeBps.toFixed(4)} bps`,
    `- Max drawdown: ${evaluation.pnl.maxDrawdown.toFixed(6)}`,
    "",
    "## Markout And Orders",
    "",
    `- Avg 5s markout: ${evaluation.markouts.avg5sBps.toFixed(4)} bps`,
    `- Avg 30s markout: ${evaluation.markouts.avg30sBps.toFixed(4)} bps`,
    `- Avg 300s markout: ${evaluation.markouts.avg300sBps.toFixed(4)} bps`,
    `- 30s markout tail: p10=${evaluation.markouts.tail30sBps.p10.toFixed(4)} bps, p5=${evaluation.markouts.tail30sBps.p5.toFixed(4)} bps, worst=${evaluation.markouts.tail30sBps.worst.toFixed(4)} bps`,
    `- Adverse selection rate: ${(evaluation.markouts.adverseSelectionRate * 100).toFixed(1)}%`,
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
    `- Market spread: ${evaluation.market.avgSpreadBps.toFixed(4)} bps`,
    `- Quote distance to mid: ${evaluation.market.avgQuoteDistanceToMidBps.toFixed(4)} bps`,
    `- Quote distance to best: ${evaluation.market.avgQuoteDistanceToBestBps.toFixed(4)} bps`,
    `- Stale rate: ${(evaluation.market.staleRate * 100).toFixed(1)}%`,
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
    `- Tuning allowed: ${evaluation.tuningAllowed}`,
    `- Issue signals: ${evaluation.issueSignals.join(", ") || "none"}`,
  ].join("\n");
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
        writeTextFile(reportPath, markdown(result)),
        writeJsonFile(join(outputDir, "metrics-report.json"), result),
      ]);
      return reportPath;
    })(),
    (error) => createAppError("metrics.report_failed", "Failed to generate metrics report", error),
  );
}

void generate(Bun.argv.slice(2)).match(
  (reportPath) => logger.info(`metrics report written to ${reportPath}`),
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
