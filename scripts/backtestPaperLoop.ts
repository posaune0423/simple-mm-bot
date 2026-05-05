import { join } from "node:path";

import { ResultAsync } from "neverthrow";

import { DIContainer } from "../src/application/di.ts";
import { ConfigLoader } from "../src/config.ts";
import type { ReportMetrics } from "../src/domain/entities/Report.ts";
import type { AppError } from "../src/utils/errors.ts";
import { createAppError, formatAppError } from "../src/utils/errors.ts";
import { ensureDirectory, writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { logger } from "../src/utils/logger.ts";

interface BacktestPaperLoopSummary {
  verdict: "pass" | "review";
  backtest: ReportMetrics;
  paper: ReportMetrics;
  window: {
    from: string;
    to: string;
    paperDurationMin: number;
  };
}

function buildBot(
  configPath: string,
  mode: "paper" | "backtest",
  dbPath: string,
  backtestWindow?: { from: string; to: string },
) {
  return ResultAsync.fromPromise(
    ConfigLoader.load({ configPath }).then(async (config) => {
      config.mode = mode;
      config.backtest.from = backtestWindow?.from ?? config.backtest.from;
      config.backtest.to = backtestWindow?.to ?? config.backtest.to;
      const previousDbPath = Bun.env.DB_PATH;
      Bun.env.DB_PATH = dbPath;
      try {
        return await new DIContainer(config).buildBot();
      } finally {
        Bun.env.DB_PATH = previousDbPath;
      }
    }),
    (error) => createAppError("loop.build_failed", "Failed to build bot runtime", error),
  );
}

function runBacktestPaperLoop(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const outputDir = options["output-dir"] ?? join("artifacts", "strategy-runs", `${Date.now()}`);
  const backtestConfigPath =
    options["backtest-config"] ?? options.config ?? "config/config.backtest.yml";
  const paperConfigPath = options["paper-config"] ?? options.config ?? "config/config.paper.yml";
  const from = options.from ?? "2024-01-01";
  const to = options.to ?? "2024-01-07";
  const paperDurationMin = Number(options["paper-duration-min"] ?? "1");
  const dbPath = join(outputDir, "loop.db");
  const paperTicks = Math.max(1, Math.round(paperDurationMin * 60));

  return ResultAsync.fromPromise(ensureDirectory(outputDir), (error) =>
    createAppError("loop.prepare_failed", "Failed to prepare output directory", error),
  )
    .andThen(() => buildBot(backtestConfigPath, "backtest", dbPath, { from, to }))
    .andThen((bot) =>
      ResultAsync.fromPromise(bot.start(), (error) =>
        createAppError("loop.backtest_failed", "Backtest execution failed", error),
      ),
    )
    .andThen((backtestReport) =>
      buildBot(paperConfigPath, "paper", dbPath).andThen((bot) =>
        ResultAsync.fromPromise(bot.start(paperTicks), (error) =>
          createAppError("loop.paper_failed", "Paper execution failed", error),
        ).map((paperReport) => ({ backtestReport, paperReport })),
      ),
    )
    .andThen(({ backtestReport, paperReport }) => {
      const summary: BacktestPaperLoopSummary = {
        verdict:
          backtestReport.metrics.netPnl >= 0 && paperReport.metrics.netPnl >= 0 ? "pass" : "review",
        backtest: backtestReport.metrics,
        paper: paperReport.metrics,
        window: { from, to, paperDurationMin },
      };

      return ResultAsync.fromPromise(
        Promise.all([
          writeJsonFile(join(outputDir, "summary.json"), summary),
          writeJsonFile(join(outputDir, "report.json"), { backtestReport, paperReport }),
          writeTextFile(
            join(outputDir, "run.md"),
            [
              "# Strategy Run",
              "",
              `- Verdict: ${summary.verdict}`,
              `- Backtest netPnl: ${backtestReport.metrics.netPnl}`,
              `- Paper netPnl: ${paperReport.metrics.netPnl}`,
              `- Output dir: ${outputDir}`,
            ].join("\n"),
          ),
        ]),
        (error) =>
          createAppError("loop.write_failed", "Failed to write backtest/paper artifacts", error),
      ).map(() => outputDir);
    });
}

void runBacktestPaperLoop(Bun.argv.slice(2)).match(
  (outputDir) => {
    logger.info(outputDir);
  },
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
