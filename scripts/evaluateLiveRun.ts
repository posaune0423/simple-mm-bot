import { join } from "node:path";

import { Database } from "bun:sqlite";
import { ResultAsync } from "neverthrow";

import type { TradingRunFact } from "../src/infrastructure/Metrics.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { ensureDirectory, writeJsonFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";
import { evaluateMetricsRun } from "./lib/MetricsEvaluation.ts";

interface PerformanceRow {
  run_id: string;
  mode: TradingRunFact["mode"];
  venue: string;
  market: string;
  capital_mode: TradingRunFact["capitalMode"];
  strategy_name: string;
  started_at: number;
  ended_at: number | null;
  status: TradingRunFact["status"];
  notional: number | null;
  fee: number | null;
  trade_pnl: number | null;
  net_pnl: number | null;
  pnl_per_notional: number | null;
  max_drawdown: number | null;
  submitted_count: number | null;
  reject_rate: number | null;
  cancel_rate: number | null;
  fill_rate: number | null;
  avg_latency_ms: number | null;
  avg_markout_5s_bps: number | null;
  adverse_selection_rate_5s: number | null;
  markout_5s_coverage: number | null;
  max_abs_position: number | null;
  avg_position: number | null;
  min_margin_ratio: number | null;
}

interface FreshnessRow {
  staleness_ms: number | null;
}

function latestRunId(dbPath: string): string | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .query<{ id: string }, []>("SELECT id FROM trading_runs ORDER BY started_at DESC LIMIT 1")
      .get();
    return row?.id ?? null;
  } finally {
    db.close();
  }
}

function loadEvaluationArtifact(dbPath: string, runId: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .query<PerformanceRow, [string]>("SELECT * FROM v_run_performance WHERE run_id = ?")
      .get(runId);
    if (row === null) {
      throw new Error(`Metrics run not found: ${runId}`);
    }
    const freshness = db
      .query<FreshnessRow, [string]>(
        `
          SELECT staleness_ms
          FROM orderbook_snapshots
          WHERE run_id = ?
          ORDER BY observed_at DESC
          LIMIT 1
        `,
      )
      .get(runId);
    const fillCount =
      db
        .query<{ count: number }, [string]>(
          "SELECT COUNT(*) AS count FROM trade_fills WHERE run_id = ?",
        )
        .get(runId)?.count ?? 0;

    const run: TradingRunFact = {
      id: row.run_id,
      mode: row.mode,
      venue: row.venue,
      market: row.market,
      capitalMode: row.capital_mode,
      strategyName: row.strategy_name,
      configJson: {},
      gitDirty: false,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      status: row.status,
    };
    const evaluation = evaluateMetricsRun({
      fillCount,
      markoutCoverage: row.markout_5s_coverage ?? 0,
      snapshotFreshnessMs: freshness?.staleness_ms ?? null,
      netPnl: row.net_pnl ?? 0,
      tradePnl: row.trade_pnl ?? 0,
      fee: row.fee ?? 0,
      pnlPerNotional: row.pnl_per_notional ?? 0,
      maxDrawdown: row.max_drawdown ?? 0,
      avg5sMarkoutBps: row.avg_markout_5s_bps ?? 0,
      adverseSelectionRate: row.adverse_selection_rate_5s ?? 0,
      fillRate: row.fill_rate ?? 0,
      rejectRate: row.reject_rate ?? 0,
      cancelRate: row.cancel_rate ?? 0,
      avgLatencyMs: row.avg_latency_ms ?? 0,
      positionSkew: row.avg_position ?? 0,
    });
    return { run, evaluation };
  } finally {
    db.close();
  }
}

function evaluate(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const dbPath = options.db ?? Bun.env.DB_PATH ?? "data/mmbot.db";
  const runId = options["run-id"] ?? latestRunId(dbPath);
  const outputDir = options["output-dir"] ?? join("artifacts", "metrics", runId ?? "unknown");

  if (runId === null) {
    return ResultAsync.fromPromise(
      Promise.reject(new Error("No trading_runs rows found")),
      (error) => createAppError("metrics.no_run", "No metrics run found", error),
    );
  }

  return ResultAsync.fromPromise(ensureDirectory(outputDir), (error) =>
    createAppError("metrics.prepare_failed", "Failed to prepare output directory", error),
  ).andThen(() =>
    ResultAsync.fromPromise(
      (async () => {
        const artifact = loadEvaluationArtifact(dbPath, runId);
        await writeJsonFile(join(outputDir, "evaluation.json"), artifact);
        return outputDir;
      })(),
      (error) => createAppError("metrics.evaluate_failed", "Failed to evaluate metrics", error),
    ),
  );
}

void evaluate(Bun.argv.slice(2)).match(
  (outputDir) => logger.info(`metrics evaluation written to ${outputDir}`),
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
