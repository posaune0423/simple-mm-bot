import { join } from "node:path";

import { Database } from "bun:sqlite";
import { ResultAsync } from "neverthrow";

import type { TradingRunFact } from "../src/domain/ports/IMetricsRepository.ts";
import { resolveSqliteDatabasePath } from "../src/utils/databaseUrl.ts";
import { METRICS_RESULTS_DIR } from "./lib/paths.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { ScriptError } from "./errors/ScriptError.ts";
import { formatUnknownError } from "../src/utils/errors.ts";
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
  avg_abs_position: number | null;
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

interface QuoteFreshnessRuntimeEventRow {
  rawJson: string | null;
}

interface RuntimeHealthCountsRow {
  warning_count: number;
  error_count: number;
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
  avg_quote_age_ms: number | null;
}

interface RiskActionCountsRow {
  reduce_count: number;
  hard_reduce_count: number;
}

interface InventoryRiskRow {
  max_abs_position: number | null;
  avg_abs_position: number | null;
  avg_position: number | null;
  min_margin_ratio: number | null;
}

interface QuoteCompetitivenessRow {
  avg_distance_to_mid_bps: number | null;
  avg_distance_to_best_bps: number | null;
}

export interface BucketEvidenceRow {
  bucket: string;
  fillCount: number;
  notionalUsd: number;
  netPnl: number;
  pnlPerVolumeBps: number | null;
  avg5sMarkoutBps: number | null;
  avg30sMarkoutBps: number | null;
  avg300sMarkoutBps: number | null;
  vw5sMarkoutBps: number | null;
  vw30sMarkoutBps: number | null;
  vw300sMarkoutBps: number | null;
  adverseSelectionRate5s: number | null;
  adverseSelectionRate30s: number | null;
  adverseSelectionRate300s: number | null;
  p5Markout30sBps: number | null;
  p1Markout30sBps: number | null;
  avgOrderLiveMs: number | null;
}

export interface BucketEvidence {
  sideIntent: BucketEvidenceRow[];
  quoteLevel: BucketEvidenceRow[];
  quoteAge: BucketEvidenceRow[];
}

export interface EvaluationResult {
  run: TradingRunFact;
  evaluation: ReturnType<typeof evaluateMetricsRun>;
  bucketEvidence: BucketEvidence;
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

export function loadEvaluationResult(dbPath: string, runId: string): EvaluationResult {
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
      .query<OrderDiagnosticsRow, [string, string, string, string]>(
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
            ) AS side_imbalance,
            (
              SELECT AVG(f.filled_at - o.submitted_at)
              FROM trade_fills f
              JOIN v_order_lifecycle o
                ON o.id = COALESCE(
                  (
                    SELECT matched.id
                    FROM v_order_lifecycle matched
                    WHERE matched.run_id = f.run_id
                      AND matched.id = f.submitted_order_id
                    LIMIT 1
                  ),
                  (
                    SELECT matched.id
                    FROM v_order_lifecycle matched
                    WHERE matched.run_id = f.run_id
                      AND f.venue_order_id IS NOT NULL
                      AND matched.venue_order_id = f.venue_order_id
                    LIMIT 1
                  )
                )
              WHERE f.run_id = ?
            ) AS avg_quote_age_ms
          FROM quote_pairs
        `,
      )
      .get(runId, runId, runId, runId);
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
    const runtimeHealthCounts = db
      .query<RuntimeHealthCountsRow, [string]>(
        `
          SELECT
            COALESCE(SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END), 0) AS warning_count,
            COALESCE(SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END), 0) AS error_count
          FROM runtime_health_events
          WHERE run_id = ?
        `,
      )
      .get(runId);
    const quoteFreshnessRows = db
      .query<QuoteFreshnessRuntimeEventRow, [string]>(
        `
          SELECT raw_json AS rawJson
          FROM runtime_health_events
          WHERE run_id = ?
            AND code = 'quote_cycle_freshness'
          ORDER BY observed_at ASC
        `,
      )
      .all(runId);
    const riskActionCounts = db
      .query<RiskActionCountsRow, [string]>(
        `
          SELECT
            COALESCE(SUM(CASE WHEN intent = 'reduce' THEN 1 ELSE 0 END), 0) AS reduce_count,
            COALESCE(SUM(CASE WHEN intent = 'close' THEN 1 ELSE 0 END), 0) AS hard_reduce_count
          FROM submitted_orders
          WHERE run_id = ?
        `,
      )
      .get(runId);
    const inventoryRisk = db
      .query<InventoryRiskRow, [string]>(
        `
          SELECT
            MAX(ABS(COALESCE(position_qty, 0))) AS max_abs_position,
            AVG(ABS(COALESCE(position_qty, 0))) AS avg_abs_position,
            AVG(position_qty) AS avg_position,
            MIN(margin_ratio) AS min_margin_ratio
          FROM account_state_observations
          WHERE run_id = ?
        `,
      )
      .get(runId);

    const runConfig = parseConfigJson(runMetadata?.config_json);
    const botIntervalMsConfig = botIntervalMs(runConfig);

    const run: TradingRunFact = {
      id: row.run_id,
      mode: row.mode,
      venue: row.venue,
      market: row.market,
      capitalMode: row.capital_mode,
      strategyName: row.strategy_name,
      configJson: runConfig,
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
      avgQuoteAgeMs: orderDiagnostics?.avg_quote_age_ms ?? null,
      avgQuoteDistanceToMidBps: quoteCompetitiveness?.avg_distance_to_mid_bps ?? 0,
      avgQuoteDistanceToBestBps: quoteCompetitiveness?.avg_distance_to_best_bps ?? 0,
      positionSkew: inventoryRisk?.avg_position ?? row.avg_position ?? 0,
      avgAbsPosition: inventoryRisk?.avg_abs_position ?? row.avg_abs_position ?? null,
      maxAbsPosition: inventoryRisk?.max_abs_position ?? row.max_abs_position ?? null,
      reduceCount: riskActionCounts?.reduce_count ?? 0,
      hardReduceCount: riskActionCounts?.hard_reduce_count ?? 0,
      minMarginRatio: inventoryRisk?.min_margin_ratio ?? row.min_margin_ratio ?? null,
      warningCount: runtimeHealthCounts?.warning_count ?? 0,
      errorCount: runtimeHealthCounts?.error_count ?? 0,
      quoteFreshness: quoteFreshnessSummary(quoteFreshnessRows, botIntervalMsConfig),
      issueSignals: row.status === "failed" ? ["order_lifecycle_inconsistency"] : [],
    });
    return { run, evaluation, bucketEvidence: loadBucketEvidence(db, runId) };
  } finally {
    db.close();
  }
}

function loadBucketEvidence(db: Database, runId: string): BucketEvidence {
  return {
    sideIntent: bucketRows(db, runId, "f.side || ':' || COALESCE(q.intent, o.intent, 'unlinked')"),
    quoteLevel: bucketRows(
      db,
      runId,
      "CASE WHEN o.quote_level IS NULL THEN 'unlinked' ELSE 'level_' || o.quote_level END",
    ),
    quoteAge: bucketRows(
      db,
      runId,
      `
        CASE
          WHEN o.submitted_at IS NULL THEN 'unlinked'
          WHEN f.filled_at - o.submitted_at < 250 THEN '<250ms'
          WHEN f.filled_at - o.submitted_at < 500 THEN '250-500ms'
          WHEN f.filled_at - o.submitted_at < 1000 THEN '500-1000ms'
          WHEN f.filled_at - o.submitted_at < 3000 THEN '1000-3000ms'
          ELSE '3000ms+'
        END
      `,
    ),
  };
}

function bucketRows(db: Database, runId: string, bucketExpression: string): BucketEvidenceRow[] {
  return db
    .query<BucketEvidenceRow, [string]>(
      `
        WITH enriched AS (
          SELECT
            f.id,
            f.price,
            f.quantity,
            f.trade_pnl,
            f.fee,
            f.filled_at,
            ${bucketExpression} AS bucket,
            o.live_ms,
            m.markout_5s_bps,
            m.markout_30s_bps,
            m.markout_300s_bps
          FROM trade_fills f
          LEFT JOIN v_order_lifecycle o
            ON o.id = COALESCE(
              (
                SELECT matched.id
                FROM v_order_lifecycle matched
                WHERE matched.run_id = f.run_id
                  AND matched.id = f.submitted_order_id
                LIMIT 1
              ),
              (
                SELECT matched.id
                FROM v_order_lifecycle matched
                WHERE matched.run_id = f.run_id
                  AND f.venue_order_id IS NOT NULL
                  AND matched.venue_order_id = f.venue_order_id
                LIMIT 1
              )
            )
          LEFT JOIN quote_decisions q
            ON q.run_id = f.run_id
           AND q.market = f.market
           AND q.quote_cycle_id = o.quote_cycle_id
           AND q.side = o.side
           AND q.level = o.quote_level
          LEFT JOIN v_fill_markouts m ON m.fill_id = f.id
          WHERE f.run_id = ?
        ),
        aggregated AS (
          SELECT
            bucket,
            COUNT(*) AS fillCount,
            SUM(price * quantity) AS notionalUsd,
            SUM(trade_pnl - fee) AS netPnl,
            CASE
              WHEN SUM(price * quantity) > 0 THEN SUM(trade_pnl - fee) / SUM(price * quantity) * 10000
              ELSE NULL
            END AS pnlPerVolumeBps,
            AVG(markout_5s_bps) AS avg5sMarkoutBps,
            AVG(markout_30s_bps) AS avg30sMarkoutBps,
            AVG(markout_300s_bps) AS avg300sMarkoutBps,
            SUM(markout_5s_bps * price * quantity) / NULLIF(SUM(CASE WHEN markout_5s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0) AS vw5sMarkoutBps,
            SUM(markout_30s_bps * price * quantity) / NULLIF(SUM(CASE WHEN markout_30s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0) AS vw30sMarkoutBps,
            SUM(markout_300s_bps * price * quantity) / NULLIF(SUM(CASE WHEN markout_300s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0) AS vw300sMarkoutBps,
            AVG(CASE WHEN markout_5s_bps IS NULL THEN NULL WHEN markout_5s_bps < 0 THEN 1 ELSE 0 END) AS adverseSelectionRate5s,
            AVG(CASE WHEN markout_30s_bps IS NULL THEN NULL WHEN markout_30s_bps < 0 THEN 1 ELSE 0 END) AS adverseSelectionRate30s,
            AVG(CASE WHEN markout_300s_bps IS NULL THEN NULL WHEN markout_300s_bps < 0 THEN 1 ELSE 0 END) AS adverseSelectionRate300s,
            AVG(live_ms) AS avgOrderLiveMs
          FROM enriched
          GROUP BY bucket
        ),
        ranked_30s AS (
          SELECT
            bucket,
            markout_30s_bps,
            ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY markout_30s_bps ASC) AS markoutRank,
            COUNT(*) OVER (PARTITION BY bucket) AS markoutCount
          FROM enriched
          WHERE markout_30s_bps IS NOT NULL
        ),
        tails AS (
          SELECT
            bucket,
            MIN(CASE
              WHEN markoutRank >= CAST((markoutCount * 5 + 99) / 100 AS INTEGER)
              THEN markout_30s_bps
              ELSE NULL
            END) AS p5Markout30sBps,
            MIN(CASE
              WHEN markoutRank >= CAST((markoutCount + 99) / 100 AS INTEGER)
              THEN markout_30s_bps
              ELSE NULL
            END) AS p1Markout30sBps
          FROM ranked_30s
          GROUP BY bucket
        )
        SELECT
          aggregated.*,
          tails.p5Markout30sBps,
          tails.p1Markout30sBps
        FROM aggregated
        LEFT JOIN tails ON tails.bucket = aggregated.bucket
        ORDER BY fillCount DESC, bucket ASC
      `,
    )
    .all(runId);
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

function tail(values: number[]): { p10: number; p5: number; p1: number | null; worst: number } {
  if (values.length === 0) {
    return { p10: 0, p5: 0, p1: null, worst: 0 };
  }
  return {
    p10: percentileSorted(values, 0.1),
    p5: percentileSorted(values, 0.05),
    p1: percentileSorted(values, 0.01),
    worst: values[0] ?? 0,
  };
}

function botIntervalMs(config: unknown): number | null {
  if (typeof config !== "object" || config === null) {
    return null;
  }
  const botConfig = (config as { bot?: { intervalMs?: unknown } }).bot;
  if (botConfig === undefined || typeof botConfig !== "object") {
    return null;
  }
  const intervalMs = botConfig.intervalMs;
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return null;
  }
  return intervalMs;
}

function quoteFreshnessSummary(
  rows: QuoteFreshnessRuntimeEventRow[],
  intervalMs: number | null,
): {
  sampleCount: number;
  totalCycleMsP50: number | null;
  totalCycleMsP95: number | null;
  totalCycleMsMax: number | null;
  qualityGateMsP95: number | null;
  recordQuoteMsP95: number | null;
  reconcileMsP95: number | null;
  bookAgeMsAtDecisionP95: number | null;
  midMoveDuringCycleBpsP95Abs: number | null;
  slowCycleRate: number | null;
} {
  if (rows.length === 0) {
    return {
      sampleCount: 0,
      totalCycleMsP50: null,
      totalCycleMsP95: null,
      totalCycleMsMax: null,
      qualityGateMsP95: null,
      recordQuoteMsP95: null,
      reconcileMsP95: null,
      bookAgeMsAtDecisionP95: null,
      midMoveDuringCycleBpsP95Abs: null,
      slowCycleRate: null,
    };
  }

  const totalCycleMs: number[] = [];
  const qualityGateMs: number[] = [];
  const recordQuoteMs: number[] = [];
  const reconcileMs: number[] = [];
  const bookAgeMsAtDecision: number[] = [];
  const midMoveDuringCycleBpsAbs: number[] = [];

  for (const row of rows) {
    const payload = parseQuoteFreshnessRawJson(row.rawJson);
    if (payload === null) {
      continue;
    }
    if (typeof payload.totalCycleMs === "number" && Number.isFinite(payload.totalCycleMs)) {
      totalCycleMs.push(payload.totalCycleMs);
    }
    if (typeof payload.qualityGateMs === "number" && Number.isFinite(payload.qualityGateMs)) {
      qualityGateMs.push(payload.qualityGateMs);
    }
    if (typeof payload.recordQuoteMs === "number" && Number.isFinite(payload.recordQuoteMs)) {
      recordQuoteMs.push(payload.recordQuoteMs);
    }
    if (typeof payload.reconcileMs === "number" && Number.isFinite(payload.reconcileMs)) {
      reconcileMs.push(payload.reconcileMs);
    }
    if (
      typeof payload.bookAgeMsAtDecision === "number" &&
      Number.isFinite(payload.bookAgeMsAtDecision)
    ) {
      bookAgeMsAtDecision.push(payload.bookAgeMsAtDecision);
    }
    if (
      typeof payload.midMoveDuringCycleBps === "number" &&
      Number.isFinite(payload.midMoveDuringCycleBps)
    ) {
      midMoveDuringCycleBpsAbs.push(Math.abs(payload.midMoveDuringCycleBps));
    }
  }

  const sampleCount = totalCycleMs.length;
  const validIntervalMs = intervalMs === null ? null : Number(intervalMs);
  const slowCycleRate =
    validIntervalMs === null || sampleCount === 0
      ? null
      : totalCycleMs.filter((value) => value > validIntervalMs).length / sampleCount;

  return {
    sampleCount,
    totalCycleMsP50: percentile(totalCycleMs, 0.5),
    totalCycleMsP95: percentile(totalCycleMs, 0.95),
    totalCycleMsMax: totalCycleMs.length === 0 ? null : Math.max(...totalCycleMs),
    qualityGateMsP95: percentile(qualityGateMs, 0.95),
    recordQuoteMsP95: percentile(recordQuoteMs, 0.95),
    reconcileMsP95: percentile(reconcileMs, 0.95),
    bookAgeMsAtDecisionP95: percentile(bookAgeMsAtDecision, 0.95),
    midMoveDuringCycleBpsP95Abs: percentile(midMoveDuringCycleBpsAbs, 0.95),
    slowCycleRate,
  };
}

function parseQuoteFreshnessRawJson(rawJson: string | null): Record<string, unknown> | null {
  if (rawJson === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
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

function percentile(values: number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sortedValues = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sortedValues.length * percentile) - 1);
  return sortedValues[index] ?? null;
}

function evaluate(argv: string[]): ResultAsync<string, ScriptError> {
  const options = parseFlagOptions(argv);
  let dbPath: string;
  try {
    dbPath = options.db ?? resolveSqliteDatabasePath(Bun.env.DATABASE_URL);
  } catch (error) {
    return ResultAsync.fromPromise(
      Promise.reject(error),
      (cause) =>
        new ScriptError(
          "script.metrics.invalid_database_url",
          "metrics:evaluate requires --db <sqlite-path> or DATABASE_URL=file:<path>",
          { cause },
        ),
    );
  }
  const runId = options["run-id"] ?? latestRunId(dbPath);
  const outputDir = options["output-dir"] ?? join(METRICS_RESULTS_DIR, runId ?? "unknown");

  if (runId === null) {
    return ResultAsync.fromPromise(
      Promise.reject(new Error("No trading_runs rows found")),
      (error) => new ScriptError("script.metrics.no_run", "No metrics run found", { cause: error }),
    );
  }

  return ResultAsync.fromPromise(
    ensureDirectory(outputDir),
    (error) =>
      new ScriptError("script.metrics.prepare_failed", "Failed to prepare output directory", {
        cause: error,
      }),
  ).andThen(() =>
    ResultAsync.fromPromise(
      (async () => {
        const result = loadEvaluationResult(dbPath, runId);
        await writeJsonFile(join(outputDir, "evaluation.json"), result);
        return outputDir;
      })(),
      (error) =>
        new ScriptError("script.metrics.evaluate_failed", "Failed to evaluate metrics", {
          cause: error,
        }),
    ),
  );
}

if (import.meta.main) {
  void evaluate(Bun.argv.slice(2)).match(
    (outputDir) => logger.info(`metrics evaluation written to ${outputDir}`),
    (error) => {
      logger.error(formatUnknownError(error));
      process.exitCode = 1;
    },
  );
}
