import { basename, join } from "node:path";

import { ResultAsync } from "neverthrow";

import { DIContainer } from "../src/application/di.ts";
import { ConfigLoader } from "../src/config.ts";
import type { PerformanceMetrics } from "../src/domain/types/PerformanceMetrics.ts";
import { resolveSqliteDatabasePath } from "../src/utils/databaseUrl.ts";
import { createSqliteClient } from "../src/infrastructure/db/sqlite/client.ts";
import { ScriptError } from "./errors/ScriptError.ts";
import { formatUnknownError } from "../src/utils/errors.ts";
import { ensureDirectory, writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { logger } from "../src/utils/logger.ts";
import { DEFAULT_BULK_BETA_CONFIG_PATH, STRATEGY_RUNS_DIR } from "./lib/paths.ts";
import { evaluateMetricsRun, type MetricsEvaluation } from "./lib/MetricsEvaluation.ts";

interface BacktestPaperLoopSummary {
  verdict: "pass" | "review";
  backtest: PerformanceMetrics;
  paper: PerformanceMetrics;
  recommendation: {
    backtest: MetricsEvaluation["parameterAction"];
    paper: MetricsEvaluation["parameterAction"];
  };
  window: {
    from: string;
    to: string;
    paperDurationMin: number;
  };
}

interface LoopRunReport {
  performance: PerformanceMetrics;
  evaluation: MetricsEvaluation;
}

interface BacktestPaperLoopOptions {
  outputDir: string;
  configPath: string;
  from: string;
  to: string;
  paperDurationMin: number;
  dbPath: string;
}

export function resolveBacktestPaperLoopOptions(
  argv: string[],
  nowMs = Date.now(),
): BacktestPaperLoopOptions {
  const options = parseFlagOptions(argv);
  const label = sanitizeRunLabel(options.label ?? "loop");
  const outputDir =
    options["output-dir"] ?? join(STRATEGY_RUNS_DIR, `${formatRunTimestamp(nowMs)}-${label}`);
  return {
    outputDir,
    configPath: options.config ?? DEFAULT_BULK_BETA_CONFIG_PATH,
    from: options.from ?? "2024-01-01",
    to: options.to ?? "2024-01-07",
    paperDurationMin: Number(options["paper-duration-min"] ?? "1"),
    dbPath: options.db ?? resolveSqliteDatabasePath(Bun.env.DATABASE_URL),
  };
}

function formatRunTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getUTCFullYear().toString(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function sanitizeRunLabel(label: string): string {
  const sanitized = label
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-");
  return sanitized.length > 0 ? sanitized : "loop";
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
      const previousDatabaseUrl = Bun.env.DATABASE_URL;
      Bun.env.DATABASE_URL = `file:${dbPath}`;
      try {
        return await new DIContainer(config).buildBot();
      } finally {
        restoreEnv("DATABASE_URL", previousDatabaseUrl);
      }
    }),
    (error) =>
      new ScriptError("script.loop.build_failed", "Failed to build bot runtime", { cause: error }),
  );
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env[key];
    return;
  }
  Bun.env[key] = value;
}

function loadLatestRunReport(
  dbPath: string,
  mode: "paper" | "backtest",
  windowDays: number,
): LoopRunReport {
  const client = createSqliteClient(dbPath);
  try {
    const row = client.sqlite
      .query<
        {
          fill_count: number;
          notional: number;
          fee: number;
          net_pnl: number;
          trade_pnl: number;
          markout_5s: number;
          markout_30s: number;
          avg_markout_30s: number;
          max_drawdown: number;
          fill_rate: number;
          side_imbalance: number;
        },
        [string]
      >(
        `
          SELECT
            COUNT(tf.id) AS fill_count,
            COALESCE(p.notional, 0) AS notional,
            COALESCE(p.fee, 0) AS fee,
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
            COALESCE((
              SELECT AVG(markout_30s_bps)
              FROM v_fill_markouts
              WHERE run_id = r.id
            ), 0) AS avg_markout_30s,
            COALESCE(d.max_drawdown, 0) AS max_drawdown,
            COALESCE(oq.fill_rate, 0) AS fill_rate,
            CASE
              WHEN COUNT(tf.id) > 0
              THEN ABS(
                SUM(CASE WHEN tf.side = 'buy' THEN 1 ELSE 0 END) -
                SUM(CASE WHEN tf.side = 'sell' THEN 1 ELSE 0 END)
              ) * 1.0 / COUNT(tf.id)
              ELSE 0
            END AS side_imbalance
          FROM trading_runs r
          LEFT JOIN trade_fills tf ON tf.run_id = r.id
          LEFT JOIN v_run_pnl p ON p.run_id = r.id
          LEFT JOIN v_run_drawdown d ON d.run_id = r.id
          LEFT JOIN v_order_quality oq ON oq.run_id = r.id
          WHERE r.mode = ?
          GROUP BY r.id
          ORDER BY r.started_at DESC
          LIMIT 1
        `,
      )
      .get(mode);

    if (row === null) {
      throw new Error(`No trading run found for mode=${mode}`);
    }

    const performance = {
      netPnl: row.net_pnl,
      tradePnl: row.trade_pnl,
      markout5s: row.markout_5s,
      markout30s: row.markout_30s,
      maxDrawdown: row.max_drawdown,
      sharpe: 0,
      fillRate: row.fill_rate,
    };
    const evaluation = evaluateMetricsRun({
      fillCount: row.fill_count,
      markoutCoverage: row.fill_count > 0 ? 1 : 0,
      notionalUsd: row.notional,
      windowDays,
      netPnl: row.net_pnl,
      tradePnl: row.trade_pnl,
      fee: row.fee,
      pnlPerNotional: row.notional > 0 ? row.net_pnl / row.notional : 0,
      pnlPerVolumeBps: row.notional > 0 ? (row.net_pnl / row.notional) * 10_000 : 0,
      maxDrawdown: row.max_drawdown,
      avg5sMarkoutBps: row.fill_count > 0 ? row.markout_5s / row.fill_count : 0,
      avg30sMarkoutBps: row.avg_markout_30s,
      adverseSelectionRate: 0,
      fillRate: row.fill_rate,
      rejectRate: 0,
      cancelRate: 0,
      sideImbalance: row.side_imbalance,
      minFillCount: 1,
    });
    return { performance, evaluation };
  } finally {
    client.sqlite.close();
  }
}

export function runBacktestPaperLoop(argv: string[]): ResultAsync<string, ScriptError> {
  const options = resolveBacktestPaperLoopOptions(argv);
  const { outputDir, configPath, from, to, paperDurationMin, dbPath } = options;
  const paperTicks = Math.max(1, Math.round(paperDurationMin * 60));

  return ResultAsync.fromPromise(
    ensureDirectory(outputDir),
    (error) =>
      new ScriptError("script.loop.prepare_failed", "Failed to prepare output directory", {
        cause: error,
      }),
  )
    .andThen(() => buildBot(configPath, "backtest", dbPath, { from, to }))
    .andThen((bot) =>
      ResultAsync.fromPromise(
        bot
          .start()
          .then(() => loadLatestRunReport(dbPath, "backtest", windowDaysBetween(from, to))),
        (error) =>
          new ScriptError("script.loop.backtest_failed", "Backtest execution failed", {
            cause: error,
          }),
      ),
    )
    .andThen((backtestReport) =>
      buildBot(configPath, "paper", dbPath).andThen((bot) =>
        ResultAsync.fromPromise(
          bot
            .start(paperTicks)
            .then(() => loadLatestRunReport(dbPath, "paper", paperDurationMin / 60 / 24)),
          (error) =>
            new ScriptError("script.loop.paper_failed", "Paper execution failed", { cause: error }),
        ).map((paperReport) => ({ backtestReport, paperReport })),
      ),
    )
    .andThen(({ backtestReport, paperReport }) => {
      const backtestMetrics = backtestReport.performance;
      const paperMetrics = paperReport.performance;
      const verdict =
        backtestReport.evaluation.verdict === "pass" && paperReport.evaluation.verdict === "pass"
          ? "pass"
          : "review";
      const summary: BacktestPaperLoopSummary = {
        verdict,
        backtest: backtestMetrics,
        paper: paperMetrics,
        recommendation: {
          backtest: backtestReport.evaluation.parameterAction,
          paper: paperReport.evaluation.parameterAction,
        },
        window: { from, to, paperDurationMin },
      };

      return ResultAsync.fromPromise(
        Promise.all([
          writeJsonFile(join(outputDir, "summary.json"), summary),
          writeJsonFile(join(outputDir, "report.json"), {
            backtest: backtestReport,
            paper: paperReport,
          }),
          writeLoopConfigSnapshot(outputDir, configPath, dbPath),
          writeTextFile(
            join(outputDir, "run.md"),
            [
              "# Strategy Run",
              "",
              `- Verdict: ${summary.verdict}`,
              `- Backtest action: ${summary.recommendation.backtest}`,
              `- Paper action: ${summary.recommendation.paper}`,
              `- Backtest netPnl: ${backtestMetrics.netPnl}`,
              `- Paper netPnl: ${paperMetrics.netPnl}`,
              `- Backtest projected ${backtestReport.evaluation.volume.targetDays}d volume: ${formatNullableNumber(backtestReport.evaluation.volume.projectedTargetUsd)}`,
              `- Paper projected ${paperReport.evaluation.volume.targetDays}d volume: ${formatNullableNumber(paperReport.evaluation.volume.projectedTargetUsd)}`,
              `- Required ${backtestReport.evaluation.volume.targetDays}d volume: ${backtestReport.evaluation.volume.requiredTargetUsd}`,
              `- Required hourly volume: ${backtestReport.evaluation.volume.requiredDailyUsd / 24}`,
              `- Required minute volume: ${backtestReport.evaluation.volume.requiredDailyUsd / 24 / 60}`,
              `- DB path: ${dbPath}`,
              `- Output dir: ${outputDir}`,
            ].join("\n"),
          ),
        ]),
        (error) =>
          new ScriptError("script.loop.write_failed", "Failed to write backtest/paper results", {
            cause: error,
          }),
      ).map(() => outputDir);
    });
}

async function writeLoopConfigSnapshot(
  outputDir: string,
  configPath: string,
  dbPath: string,
): Promise<void> {
  const metadata = [
    `dbPath: ${JSON.stringify(dbPath)}`,
    `config: ${JSON.stringify(configPath)}`,
  ].join("\n");
  await Promise.all([
    writeTextFile(join(outputDir, "config.yml"), `${metadata}\n`),
    writeTextFile(join(outputDir, basename(configPath)), await Bun.file(configPath).text()),
  ]);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function windowDaysBetween(from: string, to: string): number {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return 1;
  }
  return (toMs - fromMs) / 86_400_000;
}

if (import.meta.main) {
  void runBacktestPaperLoop(Bun.argv.slice(2)).match(
    (outputDir) => {
      logger.info(outputDir);
    },
    (error) => {
      logger.error(formatUnknownError(error));
      process.exitCode = 1;
    },
  );
}
