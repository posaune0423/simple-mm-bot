import { join } from "node:path";
import { Database } from "bun:sqlite";
import { ResultAsync } from "neverthrow";

import { createSqliteClient } from "../src/infrastructure/db/sqlite/client.ts";
import { SqliteTelemetryRepository } from "../src/infrastructure/db/sqlite/repository/SqliteTelemetryRepository.ts";
import { SqliteTradeRepository } from "../src/infrastructure/db/sqlite/repository/SqliteTradeRepository.ts";
import { evaluateTelemetryRun } from "./lib/TelemetryEvaluation.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { ensureDirectory, writeJsonFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

function latestRunId(dbPath: string): string | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .query<{ id: string }, []>("SELECT id FROM telemetry_runs ORDER BY started_at DESC LIMIT 1")
      .get();
    return row?.id ?? null;
  } finally {
    db.close();
  }
}

function evaluate(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const dbPath = options.db ?? Bun.env.DB_PATH ?? "data/mmbot.db";
  const runId = options["run-id"] ?? latestRunId(dbPath);
  const outputDir = options["output-dir"] ?? join("artifacts", "telemetry", runId ?? "unknown");

  if (runId === null) {
    return ResultAsync.fromPromise(
      Promise.reject(new Error("No telemetry_runs rows found")),
      (error) => createAppError("telemetry.no_run", "No telemetry run found", error),
    );
  }

  return ResultAsync.fromPromise(ensureDirectory(outputDir), (error) =>
    createAppError("telemetry.prepare_failed", "Failed to prepare output directory", error),
  ).andThen(() =>
    ResultAsync.fromPromise(
      (async () => {
        const client = createSqliteClient(dbPath);
        const telemetry = new SqliteTelemetryRepository(client.db);
        const trades = new SqliteTradeRepository(client.db);
        const run = await telemetry.findRun(runId);
        if (run === null) {
          throw new Error(`Telemetry run not found: ${runId}`);
        }
        const periodEnd = run.endedAt ?? Date.now();
        const events = await telemetry.findEvents({ runId });
        const fills = await trades.findByRange(run.startedAt, periodEnd);
        const quotedCount = events.filter(
          (event) => event.type === "order" && event.payload.action === "submit",
        ).length;
        const evaluation = evaluateTelemetryRun({ fills, events, quotedCount });
        const artifact = { run, evaluation };
        await writeJsonFile(join(outputDir, "evaluation.json"), artifact);
        client.sqlite.close();
        return outputDir;
      })(),
      (error) => createAppError("telemetry.evaluate_failed", "Failed to evaluate telemetry", error),
    ),
  );
}

void evaluate(Bun.argv.slice(2)).match(
  (outputDir) => logger.info(`telemetry evaluation written to ${outputDir}`),
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
