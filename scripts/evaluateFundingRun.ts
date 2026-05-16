import { join } from "node:path";

import { Database } from "bun:sqlite";

import { type FundingAccrualSample, estimateFundingAccrual } from "./lib/FundingRunEvaluation.ts";
import { METRICS_RESULTS_DIR } from "./lib/paths.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { resolveSqliteDatabasePath } from "../src/utils/databaseUrl.ts";
import { ensureDirectory, writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { logger } from "../src/utils/logger.ts";

interface RunRow {
  runId: string;
  mode: string;
  venue: string;
  market: string;
  strategyName: string;
  strategyType: string | null;
  startedAt: number;
  endedAt: number | null;
  status: string;
  rateHorizonSec: number | null;
  notional: number | null;
  fee: number | null;
  tradePnl: number | null;
  netPnl: number | null;
  submittedCount: number | null;
  fillRate: number | null;
  avgLiveMs: number | null;
  avgSpreadBps: number | null;
  maxAbsPosition: number | null;
}

interface MarkoutRow {
  fillCount: number;
  markout5Count: number;
  markout30Count: number;
  markout300Count: number;
  avgMarkout5Bps: number | null;
  avgMarkout30Bps: number | null;
  avgMarkout300Bps: number | null;
  vwMarkout5Bps: number | null;
  vwMarkout30Bps: number | null;
  vwMarkout300Bps: number | null;
  adverse5Rate: number | null;
  makerRatio: number | null;
}

interface SignalRow {
  quoteCount: number;
  fundingQuoteCount: number;
  avgFundingRateBps: number | null;
  minFundingRateBps: number | null;
  maxFundingRateBps: number | null;
  avgExpectedFundingBps: number | null;
  avgBasisBps: number | null;
  avgAlphaDriftBps: number | null;
}

interface SampleRow {
  observedAt: number;
  positionQty: number | null;
  markPrice: number;
  fundingRateBps: number | null;
}

interface EvaluatedRun {
  run: RunRow;
  markout: MarkoutRow;
  signals: SignalRow;
  funding: {
    rateHorizonSec: number;
    fundingPnlUsd: number;
    coverage: number;
    coveredMs: number;
    uncoveredMs: number;
    sampleCount: number;
    fundingSampleCount: number;
    averageFundingRateBps: number | null;
  };
  pnl: {
    netPnlUsd: number | null;
    fundingInclusiveNetPnlUsd: number | null;
    fundingPnlUsd: number;
    fundingPnlPerNotionalBps: number | null;
    fundingInclusivePnlPerNotionalBps: number | null;
  };
}

const options = parseFlagOptions(Bun.argv.slice(2));
const dbPath = resolveSqliteDatabasePath(Bun.env.DATABASE_URL);
const runIds = options.runs?.split(",").filter(Boolean);
const outputRoot = options.out ?? join(METRICS_RESULTS_DIR, "funding");

const db = new Database(dbPath, { readonly: true });
try {
  const ids = runIds && runIds.length > 0 ? runIds : latestLiveRunIds(db, 3);
  const evaluated = ids.map((runId) => evaluateRun(db, runId));
  const generatedAt = new Date().toISOString();
  const outputDir = join(outputRoot, generatedAt.replaceAll(/[:.]/g, "-"));
  const report = {
    generatedAt,
    database: dbPath,
    runs: evaluated,
  };
  await ensureDirectory(outputDir);
  await writeJsonFile(join(outputDir, "summary.json"), report);
  await writeTextFile(join(outputDir, "summary.md"), renderMarkdown(report));
  await ensureDirectory(join(METRICS_RESULTS_DIR, "latest"));
  await writeJsonFile(join(METRICS_RESULTS_DIR, "latest", "funding-summary.json"), report);
  await writeTextFile(
    join(METRICS_RESULTS_DIR, "latest", "funding-summary.md"),
    renderMarkdown(report),
  );
  logger.info("FundingRunEvaluation", "COMPLETE", `runs=${ids.join(",")} out=${outputDir}`);
} finally {
  db.close();
}

function latestLiveRunIds(db: Database, limit: number): string[] {
  return db
    .query<{ runId: string }, [number]>(
      `
        SELECT id AS runId
        FROM trading_runs
        WHERE mode = 'live'
        ORDER BY started_at DESC
        LIMIT ?
      `,
    )
    .all(limit)
    .map((row) => row.runId);
}

function evaluateRun(db: Database, runId: string): EvaluatedRun {
  const run = db
    .query<RunRow, [string]>(
      `
        SELECT
          r.id AS runId,
          r.mode,
          r.venue,
          r.market,
          r.strategy_name AS strategyName,
          json_extract(r.config_json, '$.quoteEngine.strategy.type') AS strategyType,
          r.started_at AS startedAt,
          r.ended_at AS endedAt,
          r.status,
          json_extract(
            r.config_json,
            '$.quoteEngine.strategy.params.funding.rateHorizonSec'
          ) AS rateHorizonSec,
          p.notional,
          p.fee,
          p.trade_pnl AS tradePnl,
          p.net_pnl AS netPnl,
          p.submitted_count AS submittedCount,
          p.fill_rate AS fillRate,
          p.avg_live_ms AS avgLiveMs,
          p.avg_spread_bps AS avgSpreadBps,
          p.max_abs_position AS maxAbsPosition
        FROM trading_runs r
        LEFT JOIN v_run_performance p ON p.run_id = r.id
        WHERE r.id = ?
      `,
    )
    .get(runId);
  if (run === null) {
    throw new Error(`Run not found: ${runId}`);
  }

  const markout =
    db
      .query<MarkoutRow, [string]>(
        `
        SELECT
          COUNT(*) AS fillCount,
          COUNT(markout_5s_bps) AS markout5Count,
          COUNT(markout_30s_bps) AS markout30Count,
          COUNT(markout_300s_bps) AS markout300Count,
          AVG(markout_5s_bps) AS avgMarkout5Bps,
          AVG(markout_30s_bps) AS avgMarkout30Bps,
          AVG(markout_300s_bps) AS avgMarkout300Bps,
          SUM(markout_5s_bps * price * quantity)
            / NULLIF(SUM(CASE WHEN markout_5s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0)
            AS vwMarkout5Bps,
          SUM(markout_30s_bps * price * quantity)
            / NULLIF(SUM(CASE WHEN markout_30s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0)
            AS vwMarkout30Bps,
          SUM(markout_300s_bps * price * quantity)
            / NULLIF(SUM(CASE WHEN markout_300s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0)
            AS vwMarkout300Bps,
          AVG(CASE WHEN markout_5s_bps IS NULL THEN NULL WHEN markout_5s_bps < 0 THEN 1 ELSE 0 END)
            AS adverse5Rate,
          AVG(CASE WHEN maker_taker = 'maker' THEN 1.0 ELSE 0.0 END) AS makerRatio
        FROM v_fill_markouts
        WHERE run_id = ?
      `,
      )
      .get(runId) ?? emptyMarkout();

  const signals =
    db
      .query<SignalRow, [string]>(
        `
          SELECT
            COUNT(*) AS quoteCount,
            COUNT(json_extract(raw_json, '$.fundingRateBps')) AS fundingQuoteCount,
            AVG(json_extract(raw_json, '$.fundingRateBps')) AS avgFundingRateBps,
            MIN(json_extract(raw_json, '$.fundingRateBps')) AS minFundingRateBps,
            MAX(json_extract(raw_json, '$.fundingRateBps')) AS maxFundingRateBps,
            AVG(json_extract(raw_json, '$.expectedFundingBps')) AS avgExpectedFundingBps,
            AVG(json_extract(raw_json, '$.basisBps')) AS avgBasisBps,
            AVG(json_extract(raw_json, '$.alphaDriftBps')) AS avgAlphaDriftBps
          FROM quote_decisions
          WHERE run_id = ?
        `,
      )
      .get(runId) ?? emptySignals();

  const samples = db
    .query<SampleRow, [string]>(
      `
        SELECT
          observed_at AS observedAt,
          json_extract(raw_json, '$.positionQty') AS positionQty,
          mark_price AS markPrice,
          json_extract(raw_json, '$.fundingRateBps') AS fundingRateBps
        FROM orderbook_snapshots
        WHERE run_id = ?
        ORDER BY observed_at ASC
      `,
    )
    .all(runId)
    .map(toFundingSample);

  const rateHorizonSec = run.rateHorizonSec ?? 3600;
  const fundingEstimate = estimateFundingAccrual(
    samples,
    run.endedAt ?? Date.now(),
    rateHorizonSec,
  );
  const coverageDenominator = fundingEstimate.coveredMs + fundingEstimate.uncoveredMs;
  const fundingPnlPerNotionalBps =
    run.notional !== null && run.notional > 0
      ? (fundingEstimate.fundingPnlUsd / run.notional) * 10_000
      : null;
  const fundingInclusiveNetPnlUsd =
    run.netPnl === null ? null : run.netPnl + fundingEstimate.fundingPnlUsd;

  return {
    run,
    markout,
    signals,
    funding: {
      rateHorizonSec,
      fundingPnlUsd: fundingEstimate.fundingPnlUsd,
      coverage: coverageDenominator === 0 ? 0 : fundingEstimate.coveredMs / coverageDenominator,
      coveredMs: fundingEstimate.coveredMs,
      uncoveredMs: fundingEstimate.uncoveredMs,
      sampleCount: fundingEstimate.sampleCount,
      fundingSampleCount: fundingEstimate.fundingSampleCount,
      averageFundingRateBps: fundingEstimate.averageFundingRateBps,
    },
    pnl: {
      netPnlUsd: run.netPnl,
      fundingInclusiveNetPnlUsd,
      fundingPnlUsd: fundingEstimate.fundingPnlUsd,
      fundingPnlPerNotionalBps,
      fundingInclusivePnlPerNotionalBps:
        run.notional !== null && run.notional > 0 && fundingInclusiveNetPnlUsd !== null
          ? (fundingInclusiveNetPnlUsd / run.notional) * 10_000
          : null,
    },
  };
}

function toFundingSample(row: SampleRow): FundingAccrualSample {
  return {
    observedAt: row.observedAt,
    positionQty: row.positionQty ?? 0,
    markPrice: row.markPrice,
    fundingRateBps: row.fundingRateBps,
  };
}

function emptyMarkout(): MarkoutRow {
  return {
    fillCount: 0,
    markout5Count: 0,
    markout30Count: 0,
    markout300Count: 0,
    avgMarkout5Bps: null,
    avgMarkout30Bps: null,
    avgMarkout300Bps: null,
    vwMarkout5Bps: null,
    vwMarkout30Bps: null,
    vwMarkout300Bps: null,
    adverse5Rate: null,
    makerRatio: null,
  };
}

function emptySignals(): SignalRow {
  return {
    quoteCount: 0,
    fundingQuoteCount: 0,
    avgFundingRateBps: null,
    minFundingRateBps: null,
    maxFundingRateBps: null,
    avgExpectedFundingBps: null,
    avgBasisBps: null,
    avgAlphaDriftBps: null,
  };
}

function renderMarkdown(report: { generatedAt: string; database: string; runs: EvaluatedRun[] }) {
  const rows = report.runs.map((entry) =>
    [
      shortId(entry.run.runId),
      entry.run.strategyType ?? entry.run.strategyName,
      entry.markout.fillCount.toString(),
      format(entry.run.notional, 2),
      format(entry.pnl.netPnlUsd, 6),
      format(entry.pnl.fundingPnlUsd, 9),
      format(entry.pnl.fundingInclusiveNetPnlUsd, 6),
      format(entry.markout.avgMarkout5Bps, 4),
      format(entry.markout.avgMarkout30Bps, 4),
      format(entry.markout.avgMarkout300Bps, 4),
      formatPercent(entry.funding.coverage),
      format(entry.signals.avgFundingRateBps ?? entry.funding.averageFundingRateBps, 6),
    ].join(" | "),
  );
  return [
    "# Funding Run Evaluation",
    "",
    `generatedAt: ${report.generatedAt}`,
    `database: ${report.database}`,
    "",
    "Funding PnL is an accrued estimate from observed position, mark price, and fundingRateBps. It is separate from venue-settled trade PnL in `v_run_performance`.",
    "",
    "run | strategy | fills | notional | netPnl | fundingPnl | fundingInclNetPnl | m5 | m30 | m300 | fundingCoverage | avgFundingBps",
    "--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:",
    ...rows,
    "",
  ].join("\n");
}

function shortId(runId: string): string {
  return runId.slice(0, 8);
}

function format(value: number | null, fractionDigits: number): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(fractionDigits);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}
