import { join } from "node:path";

import { Database } from "bun:sqlite";
import { ResultAsync } from "neverthrow";

import type { TradingRunFact } from "../src/infrastructure/Metrics.ts";
import { DEFAULT_SQLITE_DB_PATH, METRICS_RESULTS_DIR } from "../src/constants.ts";
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
  cancel_before_fill_rate: number | null;
  avg_live_ms: number | null;
  avg_latency_ms: number | null;
  avg_markout_5s_bps: number | null;
  adverse_selection_rate_5s: number | null;
  markout_5s_coverage: number | null;
  avg_spread_bps: number | null;
  stale_rate: number | null;
  max_abs_position: number | null;
  avg_position: number | null;
  min_margin_ratio: number | null;
}

interface RunMetadataRow {
  config_json: string;
  git_sha: string | null;
  git_dirty: number | boolean;
  stop_reason: string | null;
}

interface FreshnessRow {
  staleness_ms: number | null;
}

interface MarkoutSummaryRow {
  avg_markout_5s_bps: number | null;
  avg_markout_30s_bps: number | null;
  avg_markout_300s_bps: number | null;
  vw_markout_5s_bps: number | null;
  vw_markout_30s_bps: number | null;
  vw_markout_300s_bps: number | null;
  markout_5s_count: number;
  markout_30s_count: number;
  markout_300s_count: number;
  fill_count: number;
  adverse_selection_rate_5s: number | null;
  adverse_selection_rate_30s: number | null;
  adverse_selection_rate_300s: number | null;
}

interface FillMixRow {
  maker_ratio: number | null;
}

interface OrderDiagnosticsRow {
  quoted_spread_bps: number | null;
  realized_spread_bps: number | null;
  side_imbalance: number | null;
}

interface QuoteCompetitivenessRow {
  avg_distance_to_mid_bps: number | null;
  avg_distance_to_best_bps: number | null;
}

export function normalizeQuoteCycleId(clientOrderId: string): string {
  if (clientOrderId.includes(":bid:")) {
    return clientOrderId.replace(":bid:", ":");
  }
  if (clientOrderId.includes(":ask:")) {
    return clientOrderId.replace(":ask:", ":");
  }
  if (clientOrderId.endsWith(":bid")) {
    return clientOrderId.slice(0, -4);
  }
  if (clientOrderId.endsWith(":ask")) {
    return clientOrderId.slice(0, -4);
  }
  return clientOrderId;
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

export function loadEvaluationResult(dbPath: string, runId: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .query<PerformanceRow, [string]>("SELECT * FROM v_run_performance WHERE run_id = ?")
      .get(runId);
    if (row === null) {
      throw new Error(`Metrics run not found: ${runId}`);
    }
    const runMetadata = db
      .query<RunMetadataRow, [string]>(
        "SELECT config_json, git_sha, git_dirty, stop_reason FROM trading_runs WHERE id = ?",
      )
      .get(runId);
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
    const markoutSummary = db
      .query<MarkoutSummaryRow, [string]>(
        `
          SELECT
            AVG(m.markout_5s_bps) AS avg_markout_5s_bps,
            AVG(m.markout_30s_bps) AS avg_markout_30s_bps,
            AVG(m.markout_300s_bps) AS avg_markout_300s_bps,
            SUM(m.markout_5s_bps * f.price * f.quantity) / NULLIF(SUM(CASE WHEN m.markout_5s_bps IS NOT NULL THEN f.price * f.quantity ELSE 0 END), 0) AS vw_markout_5s_bps,
            SUM(m.markout_30s_bps * f.price * f.quantity) / NULLIF(SUM(CASE WHEN m.markout_30s_bps IS NOT NULL THEN f.price * f.quantity ELSE 0 END), 0) AS vw_markout_30s_bps,
            SUM(m.markout_300s_bps * f.price * f.quantity) / NULLIF(SUM(CASE WHEN m.markout_300s_bps IS NOT NULL THEN f.price * f.quantity ELSE 0 END), 0) AS vw_markout_300s_bps,
            COUNT(m.markout_5s_bps) AS markout_5s_count,
            COUNT(m.markout_30s_bps) AS markout_30s_count,
            COUNT(m.markout_300s_bps) AS markout_300s_count,
            COUNT(*) AS fill_count,
            AVG(CASE WHEN m.markout_5s_bps IS NULL THEN NULL WHEN m.markout_5s_bps < 0 THEN 1 ELSE 0 END) AS adverse_selection_rate_5s,
            AVG(CASE WHEN m.markout_30s_bps IS NULL THEN NULL WHEN m.markout_30s_bps < 0 THEN 1 ELSE 0 END) AS adverse_selection_rate_30s,
            AVG(CASE WHEN m.markout_300s_bps IS NULL THEN NULL WHEN m.markout_300s_bps < 0 THEN 1 ELSE 0 END) AS adverse_selection_rate_300s
          FROM v_fill_markouts m
          JOIN trade_fills f ON f.id = m.fill_id
          WHERE m.run_id = ?
        `,
      )
      .get(runId);
    const fillMix = db
      .query<FillMixRow, [string]>(
        `
          SELECT
            SUM(CASE WHEN maker_taker = 'maker' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) AS maker_ratio
          FROM trade_fills
          WHERE run_id = ?
        `,
      )
      .get(runId);
    const markout30s = db
      .query<{ markout_30s_bps: number }, [string]>(
        `
          SELECT markout_30s_bps
          FROM v_fill_markouts
          WHERE run_id = ?
            AND markout_30s_bps IS NOT NULL
          ORDER BY markout_30s_bps ASC
        `,
      )
      .all(runId)
      .map((entry) => entry.markout_30s_bps);
    const orderDiagnostics = db
      .query<OrderDiagnosticsRow, [string, string, string]>(
        `
          WITH order_prefixes AS (
            SELECT
              run_id,
              CASE
                WHEN client_order_id LIKE '%:bid:%' THEN replace(client_order_id, ':bid:', ':')
                WHEN client_order_id LIKE '%:ask:%' THEN replace(client_order_id, ':ask:', ':')
                WHEN client_order_id LIKE '%:bid' THEN substr(client_order_id, 1, length(client_order_id) - 4)
                WHEN client_order_id LIKE '%:ask' THEN substr(client_order_id, 1, length(client_order_id) - 4)
                ELSE client_order_id
              END AS quote_cycle_id,
              side,
              limit_price
            FROM submitted_orders
            WHERE run_id = ?
              AND intent = 'quote'
          ),
          quote_pairs AS (
            SELECT
              quote_cycle_id,
              MAX(CASE WHEN side = 'buy' THEN limit_price ELSE NULL END) AS bid_price,
              MAX(CASE WHEN side = 'sell' THEN limit_price ELSE NULL END) AS ask_price
            FROM order_prefixes
            GROUP BY quote_cycle_id
          ),
          fill_mid AS (
            SELECT
              f.id,
              f.side,
              f.price,
              (
                SELECT s.mid_price
                FROM orderbook_snapshots s
                WHERE s.run_id = f.run_id
                  AND s.market = f.market
                  AND s.observed_at <= f.filled_at
                ORDER BY s.observed_at DESC
                LIMIT 1
              ) AS mid_price
            FROM trade_fills f
            WHERE f.run_id = ?
          ),
          side_counts AS (
            SELECT
              COUNT(*) AS total_count,
              SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) AS buy_count,
              SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) AS sell_count
            FROM trade_fills
            WHERE run_id = ?
          )
          SELECT
            AVG(CASE
              WHEN bid_price IS NOT NULL AND bid_price > 0 AND ask_price IS NOT NULL
              THEN ((ask_price - bid_price) / bid_price) * 10000
              ELSE NULL
            END) AS quoted_spread_bps,
            (
              SELECT AVG(CASE
                WHEN mid_price IS NULL THEN NULL
                WHEN side = 'buy' THEN ((mid_price - price) / price) * 10000
                ELSE ((price - mid_price) / price) * 10000
              END)
              FROM fill_mid
            ) AS realized_spread_bps,
            (
              SELECT CASE
                WHEN total_count > 0 THEN ABS(buy_count - sell_count) * 1.0 / total_count
                ELSE 0
              END
              FROM side_counts
            ) AS side_imbalance
          FROM quote_pairs
        `,
      )
      .get(runId, runId, runId);
    const quoteCompetitiveness = db
      .query<QuoteCompetitivenessRow, [string]>(
        `
          SELECT
            AVG(distance_to_mid_bps) AS avg_distance_to_mid_bps,
            AVG(distance_to_best_bps) AS avg_distance_to_best_bps
          FROM v_quote_competitiveness
          WHERE run_id = ?
        `,
      )
      .get(runId);

    const run: TradingRunFact = {
      id: row.run_id,
      mode: row.mode,
      venue: row.venue,
      market: row.market,
      capitalMode: row.capital_mode,
      strategyName: row.strategy_name,
      configJson: parseConfigJson(runMetadata?.config_json),
      gitSha: runMetadata?.git_sha ?? undefined,
      gitDirty: Boolean(runMetadata?.git_dirty ?? false),
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      status: row.status,
      stopReason: runMetadata?.stop_reason ?? undefined,
    };
    const markoutTotal = markoutSummary?.fill_count ?? fillCount;
    const evaluation = evaluateMetricsRun({
      fillCount,
      markoutCoverage: coverage(markoutSummary?.markout_5s_count ?? 0, markoutTotal),
      markoutCoverageByHorizon: {
        "5s": horizonCoverage(markoutSummary?.markout_5s_count ?? 0, markoutTotal),
        "30s": horizonCoverage(markoutSummary?.markout_30s_count ?? 0, markoutTotal),
        "300s": horizonCoverage(markoutSummary?.markout_300s_count ?? 0, markoutTotal),
      },
      snapshotFreshnessMs: freshness?.staleness_ms ?? null,
      notionalUsd: row.notional ?? 0,
      windowDays: evaluationWindowDays(row.started_at, row.ended_at),
      netPnl: row.net_pnl ?? 0,
      tradePnl: row.trade_pnl ?? 0,
      fee: row.fee ?? 0,
      pnlPerNotional: row.pnl_per_notional ?? 0,
      pnlPerVolumeBps: (row.pnl_per_notional ?? 0) * 10_000,
      maxDrawdown: row.max_drawdown ?? 0,
      avg5sMarkoutBps: markoutSummary?.avg_markout_5s_bps ?? row.avg_markout_5s_bps ?? 0,
      avg30sMarkoutBps: markoutSummary?.avg_markout_30s_bps ?? null,
      avg300sMarkoutBps: markoutSummary?.avg_markout_300s_bps ?? null,
      vw5sMarkoutBps: markoutSummary?.vw_markout_5s_bps ?? null,
      vw30sMarkoutBps: markoutSummary?.vw_markout_30s_bps ?? null,
      vw300sMarkoutBps: markoutSummary?.vw_markout_300s_bps ?? null,
      markout30sTailBps: tail(markout30s),
      adverseSelectionRate:
        markoutSummary?.adverse_selection_rate_5s ?? row.adverse_selection_rate_5s ?? 0,
      adverseSelectionRate5s:
        markoutSummary?.adverse_selection_rate_5s ?? row.adverse_selection_rate_5s ?? 0,
      adverseSelectionRate30s: markoutSummary?.adverse_selection_rate_30s ?? null,
      adverseSelectionRate300s: markoutSummary?.adverse_selection_rate_300s ?? null,
      spreadCaptureBps: orderDiagnostics?.quoted_spread_bps ?? 0,
      realizedSpreadBps: orderDiagnostics?.realized_spread_bps ?? 0,
      sideImbalance: orderDiagnostics?.side_imbalance ?? 0,
      avgMarketSpreadBps: row.avg_spread_bps ?? 0,
      staleRate: row.stale_rate ?? 0,
      fillRate: row.fill_rate ?? 0,
      rejectRate: row.reject_rate ?? 0,
      cancelRate: row.cancel_rate ?? 0,
      cancelBeforeFillRate: row.cancel_before_fill_rate ?? 0,
      makerRatio: fillMix?.maker_ratio ?? 0,
      avgLatencyMs: row.avg_latency_ms ?? 0,
      avgOrderLiveMs: row.avg_live_ms ?? undefined,
      avgQuoteDistanceToMidBps: quoteCompetitiveness?.avg_distance_to_mid_bps ?? 0,
      avgQuoteDistanceToBestBps: quoteCompetitiveness?.avg_distance_to_best_bps ?? 0,
      positionSkew: row.avg_position ?? 0,
      issueSignals: row.status === "failed" ? ["order_lifecycle_inconsistency"] : [],
    });
    return { run, evaluation };
  } finally {
    db.close();
  }
}

function evaluationWindowDays(startedAt: number, endedAt: number | null): number {
  const end = endedAt ?? Date.now();
  return Math.max((end - startedAt) / 86_400_000, 1 / 1_440);
}

function horizonCoverage(observed: number, total: number) {
  return {
    observed,
    total,
    coverage: coverage(observed, total),
  };
}

function coverage(observed: number, total: number): number {
  return total > 0 ? observed / total : 0;
}

function tail(values: number[]): { p10: number; p5: number; worst: number } {
  if (values.length === 0) {
    return { p10: 0, p5: 0, worst: 0 };
  }
  return {
    p10: percentileSorted(values, 0.1),
    p5: percentileSorted(values, 0.05),
    worst: values[0] ?? 0,
  };
}

function parseConfigJson(configJson: string | undefined): unknown {
  if (configJson === undefined) {
    return {};
  }
  try {
    return JSON.parse(configJson);
  } catch {
    return {};
  }
}

function percentileSorted(values: number[], percentile: number): number {
  const index = Math.max(0, Math.ceil(values.length * percentile) - 1);
  return values[index] ?? 0;
}

function evaluate(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const dbPath = options.db ?? Bun.env.DB_PATH ?? DEFAULT_SQLITE_DB_PATH;
  const runId = options["run-id"] ?? latestRunId(dbPath);
  const outputDir = options["output-dir"] ?? join(METRICS_RESULTS_DIR, runId ?? "unknown");

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
        const result = loadEvaluationResult(dbPath, runId);
        await writeJsonFile(join(outputDir, "evaluation.json"), result);
        return outputDir;
      })(),
      (error) => createAppError("metrics.evaluate_failed", "Failed to evaluate metrics", error),
    ),
  );
}

if (import.meta.main) {
  void evaluate(Bun.argv.slice(2)).match(
    (outputDir) => logger.info(`metrics evaluation written to ${outputDir}`),
    (error) => {
      logger.error(formatAppError(error));
      process.exitCode = 1;
    },
  );
}
