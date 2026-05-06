import { ResultAsync } from "neverthrow";

import type { Fill } from "../src/domain/entities/Fill.ts";
import { createSqliteClient } from "../src/infrastructure/db/sqlite/client.ts";
import { fetchFills } from "../src/reporting/queries/FillsQuery.ts";
import {
  DEFAULT_PERIODS,
  defaultOutputDir,
  generateReport,
} from "../src/reporting/report/generator.ts";
import type { PeriodWindow } from "../src/reporting/report/generator.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import type { AppError } from "../src/utils/errors.ts";
import { createAppError, formatAppError } from "../src/utils/errors.ts";
import { logger } from "../src/utils/logger.ts";

interface RunOptions {
  mode: string;
  venue?: string;
  outputDir: string;
  dbPath: string;
  periods: PeriodWindow[];
  now: number;
}

function parseOptions(argv: string[]): RunOptions {
  const flags = parseFlagOptions(argv);
  const mode = flags.mode ?? "live";
  const venue = flags.venue;
  const outputDir = flags["output"] ?? flags["output-dir"] ?? defaultOutputDir();
  const dbPath = flags.db ?? Bun.env.DB_PATH ?? "data/mmbot.db";
  const now = flags.now ? Number(flags.now) : Date.now();
  const periodKey = flags.period ?? "both";
  const periods = selectPeriods(periodKey);
  return { mode, venue, outputDir, dbPath, periods, now };
}

function selectPeriods(key: string): PeriodWindow[] {
  if (key === "24h") return DEFAULT_PERIODS.filter((p) => p.key === "24h");
  if (key === "7d") return DEFAULT_PERIODS.filter((p) => p.key === "7d");
  return [...DEFAULT_PERIODS];
}

function runGenerateReport(argv: string[]): ResultAsync<string, AppError> {
  const options = parseOptions(argv);
  logger.info(
    `Starting report generation: mode=${options.mode}, venue=${options.venue ?? "all"}, periods=${options.periods.map((p) => p.key).join(",")}, output=${options.outputDir}`,
  );

  return ResultAsync.fromPromise(Promise.resolve(createSqliteClient(options.dbPath)), (error) =>
    createAppError("report.db_open_failed", "Failed to open SQLite database", error),
  ).andThen((client) =>
    ResultAsync.fromPromise(
      generateReport({
        fetchFills: async (input): Promise<Fill[]> => fetchFills({ db: client.db, ...input }),
        now: options.now,
        mode: options.mode,
        venue: options.venue,
        outputDir: options.outputDir,
        periods: options.periods,
      }),
      (error) => createAppError("report.generate_failed", "Failed to generate report", error),
    ).map((result) => {
      client.sqlite.close();
      return result.latestMd;
    }),
  );
}

void runGenerateReport(Bun.argv.slice(2)).match(
  (path) => {
    logger.info(`Report generated at ${path}`);
  },
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
