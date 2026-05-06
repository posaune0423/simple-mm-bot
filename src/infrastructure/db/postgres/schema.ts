import { bigint, boolean, doublePrecision, pgTable, text } from "drizzle-orm/pg-core";

export const fillsTable = pgTable("fills", {
  id: text("id").primaryKey(),
  venue: text("venue").notNull(),
  market: text("market").notNull(),
  side: text("side").notNull(),
  price: doublePrecision("price").notNull(),
  qty: doublePrecision("qty").notNull(),
  fee: doublePrecision("fee").notNull(),
  tradePnl: doublePrecision("trade_pnl").notNull(),
  filledAt: bigint("filled_at", { mode: "number" }).notNull(),
  quoteId: text("quote_id"),
  markPriceAtFill: doublePrecision("mark_price_at_fill"),
  markPrice5s: doublePrecision("mark_price_5s"),
  markPrice30s: doublePrecision("mark_price_30s"),
});

export const reportsTable = pgTable("reports", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  venue: text("venue").notNull(),
  periodStart: bigint("period_start", { mode: "number" }).notNull(),
  periodEnd: bigint("period_end", { mode: "number" }).notNull(),
  metricsJson: text("metrics_json").notNull(),
  equityCurveJson: text("equity_curve_json").notNull(),
  fillAnalysisJson: text("fill_analysis_json").notNull(),
});

export const ohlcvTable = pgTable("ohlcv", {
  market: text("market").notNull(),
  timeframe: text("timeframe").notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume").notNull(),
});

export const telemetryRunsTable = pgTable("telemetry_runs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  venue: text("venue").notNull(),
  capitalMode: text("capital_mode").notNull(),
  market: text("market").notNull(),
  configJson: text("config_json").notNull(),
  gitSha: text("git_sha"),
  gitDirty: boolean("git_dirty").notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  endedAt: bigint("ended_at", { mode: "number" }),
  status: text("status").notNull(),
});

export const telemetryEventsTable = pgTable("telemetry_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  mode: text("mode").notNull(),
  venue: text("venue").notNull(),
  type: text("type").notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  market: text("market"),
  payloadJson: text("payload_json").notNull(),
});
