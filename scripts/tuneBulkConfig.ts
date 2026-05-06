import { ResultAsync } from "neverthrow";

import { tuneBulkConfigDocument } from "./lib/BulkConfigTuning.ts";
import type { TelemetryEvaluation } from "./lib/TelemetryEvaluation.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface EvaluationArtifact {
  evaluation: TelemetryEvaluation;
}

function tune(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const configPath = options.config ?? "config/config.bulk.yml";
  const evaluationPath = options.evaluation ?? "artifacts/telemetry/latest/evaluation.json";
  const outputPath = options["output"] ?? configPath;
  const dryRun = options["dry-run"] === "true";

  return ResultAsync.fromPromise(
    (async () => {
      const [configText, artifact] = await Promise.all([
        Bun.file(configPath).text(),
        Bun.file(evaluationPath).json() as Promise<EvaluationArtifact>,
      ]);
      const tuned = tuneBulkConfigDocument(configText, artifact.evaluation);
      if (!dryRun && tuned.changed) {
        await writeTextFile(outputPath, tuned.content);
      }
      await writeJsonFile(`${outputPath}.tuning.json`, {
        changed: tuned.changed,
        actions: tuned.actions,
        dryRun,
      });
      return outputPath;
    })(),
    (error) => createAppError("telemetry.tune_failed", "Failed to tune Bulk config", error),
  );
}

void tune(Bun.argv.slice(2)).match(
  (outputPath) => logger.info(`bulk config tuning evaluated for ${outputPath}`),
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
