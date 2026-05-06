import { join } from "node:path";
import { ResultAsync } from "neverthrow";

import type { TelemetryEvaluation } from "./lib/TelemetryEvaluation.ts";
import type { TelemetryRun } from "../src/infrastructure/Telemetry.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface EvaluationArtifact {
  run: TelemetryRun;
  evaluation: TelemetryEvaluation;
}

function markdown(artifact: EvaluationArtifact): string {
  const { run, evaluation } = artifact;
  return [
    "# Telemetry Run Report",
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
    `- Max drawdown: ${evaluation.pnl.maxDrawdown.toFixed(6)}`,
    "",
    "## Markout And Orders",
    "",
    `- Avg 5s markout: ${evaluation.markouts.avg5sBps.toFixed(4)} bps`,
    `- Adverse selection rate: ${(evaluation.markouts.adverseSelectionRate * 100).toFixed(1)}%`,
    `- Spread capture: ${evaluation.markouts.spreadCaptureBps.toFixed(4)} bps`,
    `- Fill rate: ${(evaluation.orderQuality.fillRate * 100).toFixed(1)}%`,
    `- Reject rate: ${(evaluation.orderQuality.rejectRate * 100).toFixed(1)}%`,
    `- Cancel rate: ${(evaluation.orderQuality.cancelRate * 100).toFixed(1)}%`,
    `- Maker ratio: ${(evaluation.orderQuality.makerRatio * 100).toFixed(1)}%`,
    `- Avg latency: ${evaluation.orderQuality.avgLatencyMs.toFixed(2)} ms`,
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
  const evaluationPath = options.evaluation ?? "artifacts/telemetry/latest/evaluation.json";
  const outputDir = options["output-dir"] ?? "artifacts/telemetry/latest";

  return ResultAsync.fromPromise(
    (async () => {
      const artifact = (await Bun.file(evaluationPath).json()) as EvaluationArtifact;
      const reportPath = join(outputDir, "telemetry-report.md");
      await Promise.all([
        writeTextFile(reportPath, markdown(artifact)),
        writeJsonFile(join(outputDir, "telemetry-report.json"), artifact),
      ]);
      return reportPath;
    })(),
    (error) =>
      createAppError("telemetry.report_failed", "Failed to generate telemetry report", error),
  );
}

void generate(Bun.argv.slice(2)).match(
  (reportPath) => logger.info(`telemetry report written to ${reportPath}`),
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
