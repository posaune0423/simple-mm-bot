import { join } from "node:path";

import { ResultAsync } from "neverthrow";

import { DIContainer } from "../src/application/di.ts";
import { ConfigLoader } from "../src/config.ts";
import type { PerformanceMetrics } from "../src/domain/entities/PerformanceMetrics.ts";
import { createSqliteClient } from "../src/infrastructure/db/sqlite/client.ts";
import type { AppError } from "../src/utils/errors.ts";
import { createAppError, formatAppError } from "../src/utils/errors.ts";
import { ensureDirectory, writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { logger } from "../src/utils/logger.ts";

interface BacktestPaperLoopSummary {
  verdict: "pass" | "review";
  backtest: PerformanceMetrics;
  paper: PerformanceMetrics;
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

function loadLatestPerformanceMetrics(
  dbPath: string,
  mode: "paper" | "backtest",
): PerformanceMetrics {
  const client = createSqliteClient(dbPath);
  try {
    const row = client.sqlite
      .query<
        {
          net_pnl: number;
          trade_pnl: number;
          markout_5s: number;
          markout_30s: number;
          max_drawdown: number;
          fill_rate: number;
        },
        [string]
      >(
        `
          SELECT
            COALESCE(p.net_pnl, 0) AS net_pnl,
            COALESCE(p.trade_pnl, 0) AS trade_pnl,
            COALESCE((
              SELECT SUM(markout_5s_bps)
              FROM v_fill_markouts
              WHERE run_id = r.id
            ), 0) AS markout_5s,
            COALESCE((
              SELECT SUM(markout_30s_bps)
              FROM v_fill_markouts
              WHERE run_id = r.id
            ), 0) AS markout_30s,
            COALESCE(d.max_drawdown, 0) AS max_drawdown,
            COALESCE(oq.fill_rate, 0) AS fill_rate
          FROM trading_runs r
          LEFT JOIN v_run_pnl p ON p.run_id = r.id
          LEFT JOIN v_run_drawdown d ON d.run_id = r.id
          LEFT JOIN v_order_quality oq ON oq.run_id = r.id
          WHERE r.mode = ?
          ORDER BY r.started_at DESC
          LIMIT 1
        `,
      )
      .get(mode);

    if (row === null) {
      throw new Error(`No trading run found for mode=${mode}`);
    }

    return {
      netPnl: row.net_pnl,
      tradePnl: row.trade_pnl,
      markout5s: row.markout_5s,
      markout30s: row.markout_30s,
      maxDrawdown: row.max_drawdown,
      sharpe: 0,
      fillRate: row.fill_rate,
    };
  } finally {
    client.sqlite.close();
  }
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
      ResultAsync.fromPromise(
        bot.start().then(() => loadLatestPerformanceMetrics(dbPath, "backtest")),
        (error) => createAppError("loop.backtest_failed", "Backtest execution failed", error),
      ),
    )
    .andThen((backtestMetrics) =>
      buildBot(paperConfigPath, "paper", dbPath).andThen((bot) =>
        ResultAsync.fromPromise(
          bot.start(paperTicks).then(() => loadLatestPerformanceMetrics(dbPath, "paper")),
          (error) => createAppError("loop.paper_failed", "Paper execution failed", error),
        ).map((paperMetrics) => ({ backtestMetrics, paperMetrics })),
      ),
    )
    .andThen(({ backtestMetrics, paperMetrics }) => {
      const summary: BacktestPaperLoopSummary = {
        verdict: backtestMetrics.netPnl >= 0 && paperMetrics.netPnl >= 0 ? "pass" : "review",
        backtest: backtestMetrics,
        paper: paperMetrics,
        window: { from, to, paperDurationMin },
      };

      return ResultAsync.fromPromise(
        Promise.all([
          writeJsonFile(join(outputDir, "summary.json"), summary),
          writeJsonFile(join(outputDir, "metrics.json"), {
            backtest: backtestMetrics,
            paper: paperMetrics,
          }),
          writeTextFile(
            join(outputDir, "run.md"),
            [
              "# Strategy Run",
              "",
              `- Verdict: ${summary.verdict}`,
              `- Backtest netPnl: ${backtestMetrics.netPnl}`,
              `- Paper netPnl: ${paperMetrics.netPnl}`,
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
