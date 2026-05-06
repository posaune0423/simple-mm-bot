import { ResultAsync } from "neverthrow";

import { planDesignIssues } from "./lib/DesignIssuePlanner.ts";
import type { TelemetryEvaluation } from "./lib/TelemetryEvaluation.ts";
import type { TelemetryRun } from "../src/infrastructure/Telemetry.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { writeJsonFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface EvaluationArtifact {
  run: TelemetryRun;
  evaluation: TelemetryEvaluation;
}

async function createGitHubIssue(title: string, body: string, label: string): Promise<void> {
  const result = Bun.spawnSync(
    ["gh", "issue", "create", "--title", title, "--body", body, "--label", label],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr).trim());
  }
}

function createIssues(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const evaluationPath = options.evaluation ?? "artifacts/telemetry/latest/evaluation.json";
  const reportPath = options.report ?? "artifacts/telemetry/latest/telemetry-report.md";
  const outputPath = options.output ?? "artifacts/telemetry/issues.json";
  const dryRun = options["dry-run"] === "true";

  return ResultAsync.fromPromise(
    (async () => {
      const artifact = (await Bun.file(evaluationPath).json()) as EvaluationArtifact;
      const issues = planDesignIssues({
        issueSignals: artifact.evaluation.issueSignals,
        runId: artifact.run.id,
        reportPath,
      });
      if (!dryRun) {
        for (const issue of issues) {
          await createGitHubIssue(issue.title, issue.body, issue.label);
        }
      }
      await writeJsonFile(outputPath, { dryRun, issues });
      return outputPath;
    })(),
    (error) =>
      createAppError("telemetry.issue_failed", "Failed to create telemetry design issues", error),
  );
}

void createIssues(Bun.argv.slice(2)).match(
  (outputPath) => logger.info(`telemetry issue plan written to ${outputPath}`),
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
