import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const fillsTable = sqliteTable("fills", {
  id: text("id").primaryKey(),
  venue: text("venue").notNull(),
  market: text("market").notNull(),
  side: text("side").notNull(),
  price: real("price").notNull(),
  qty: real("qty").notNull(),
  fee: real("fee").notNull(),
  tradePnl: real("trade_pnl").notNull(),
  filledAt: integer("filled_at").notNull(),
  quoteId: text("quote_id"),
  markPriceAtFill: real("mark_price_at_fill"),
  markPrice5s: real("mark_price_5s"),
  markPrice30s: real("mark_price_30s"),
});

export const reportsTable = sqliteTable("reports", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  venue: text("venue").notNull(),
  periodStart: integer("period_start").notNull(),
  periodEnd: integer("period_end").notNull(),
  metricsJson: text("metrics_json").notNull(),
  equityCurveJson: text("equity_curve_json").notNull(),
  fillAnalysisJson: text("fill_analysis_json").notNull(),
});

export const ohlcvTable = sqliteTable("ohlcv", {
  market: text("market").notNull(),
  timeframe: text("timeframe").notNull(),
  ts: integer("ts").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull(),
});
