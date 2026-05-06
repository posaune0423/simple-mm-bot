import { ResultAsync } from "neverthrow";

import { planDesignIssues } from "./lib/DesignIssuePlanner.ts";
import type { MetricsEvaluation } from "./lib/MetricsEvaluation.ts";
import type { TradingRunFact } from "../src/infrastructure/Metrics.ts";
import {
  LATEST_METRICS_EVALUATION_PATH,
  LATEST_METRICS_REPORT_PATH,
  METRICS_ISSUES_PATH,
} from "../src/runtimePaths.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { writeJsonFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface EvaluationArtifact {
  run: TradingRunFact;
  evaluation: MetricsEvaluation;
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
  const evaluationPath = options.evaluation ?? LATEST_METRICS_EVALUATION_PATH;
  const reportPath = options.report ?? LATEST_METRICS_REPORT_PATH;
  const outputPath = options.output ?? METRICS_ISSUES_PATH;
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
      createAppError("metrics.issue_failed", "Failed to create metrics design issues", error),
  );
}

void createIssues(Bun.argv.slice(2)).match(
  (outputPath) => logger.info(`metrics issue plan written to ${outputPath}`),
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
