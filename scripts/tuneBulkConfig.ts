import { ResultAsync } from "neverthrow";

import { tuneBulkConfigDocument } from "./lib/BulkConfigTuning.ts";
import type { MetricsEvaluation } from "./lib/MetricsEvaluation.ts";
import { DEFAULT_BULK_BETA_CONFIG_PATH, LATEST_METRICS_EVALUATION_PATH } from "./lib/paths.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { ScriptError } from "./errors/ScriptError.ts";
import { formatUnknownError } from "../src/utils/errors.ts";
import { writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface EvaluationResult {
  evaluation: MetricsEvaluation;
}

function tune(argv: string[]): ResultAsync<string, ScriptError> {
  const options = parseFlagOptions(argv);
  const configPath = options.config ?? DEFAULT_BULK_BETA_CONFIG_PATH;
  const evaluationPath = options.evaluation ?? LATEST_METRICS_EVALUATION_PATH;
  const outputPath = options["output"] ?? configPath;
  const dryRun = options["dry-run"] === "true";

  return ResultAsync.fromPromise(
    (async () => {
      const [configText, result] = await Promise.all([
        Bun.file(configPath).text(),
        Bun.file(evaluationPath).json() as Promise<EvaluationResult>,
      ]);
      const tuned = tuneBulkConfigDocument(configText, result.evaluation);
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
    (error) =>
      new ScriptError("script.metrics.tune_failed", "Failed to tune Bulk config", { cause: error }),
  );
}

void tune(Bun.argv.slice(2)).match(
  (outputPath) => logger.info(`bulk config tuning evaluated for ${outputPath}`),
  (error) => {
    logger.error(formatUnknownError(error));
    process.exitCode = 1;
  },
);
