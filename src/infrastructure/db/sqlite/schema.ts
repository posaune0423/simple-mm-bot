import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const tradingRunsTable = sqliteTable("trading_runs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  venue: text("venue").notNull(),
  market: text("market").notNull(),
  capitalMode: text("capital_mode").notNull(),
  strategyName: text("strategy_name").notNull(),
  configJson: text("config_json").notNull(),
  gitSha: text("git_sha"),
  gitDirty: integer("git_dirty", { mode: "boolean" }).notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  status: text("status").notNull(),
  stopReason: text("stop_reason"),
});

export const orderbookSnapshotsTable = sqliteTable(
  "orderbook_snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    observedAt: integer("observed_at").notNull(),
    bestBid: real("best_bid").notNull(),
    bestAsk: real("best_ask").notNull(),
    midPrice: real("mid_price").notNull(),
    microPrice: real("micro_price").notNull(),
    vampPrice: real("vamp_price"),
    markPrice: real("mark_price").notNull(),
    spreadBps: real("spread_bps").notNull(),
    stalenessMs: integer("staleness_ms").notNull(),
    rawJson: text("raw_json"),
  },
  (table) => [
    uniqueIndex("orderbook_snapshots_run_market_observed_at").on(
      table.runId,
      table.market,
      table.observedAt,
    ),
  ],
);

export const submittedOrdersTable = sqliteTable(
  "submitted_orders",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    clientOrderId: text("client_order_id").notNull(),
    venueOrderId: text("venue_order_id"),
    intent: text("intent").notNull(),
    side: text("side").notNull(),
    orderType: text("order_type").notNull(),
    limitPrice: real("limit_price"),
    quantity: real("quantity").notNull(),
    timeInForce: text("time_in_force").notNull(),
    submittedAt: integer("submitted_at").notNull(),
    acceptedAt: integer("accepted_at"),
    rejectedAt: integer("rejected_at"),
    canceledAt: integer("canceled_at"),
    finalStatus: text("final_status").notNull(),
    rejectReason: text("reject_reason"),
    latencyMs: integer("latency_ms"),
    rawJson: text("raw_json"),
  },
  (table) => [
    uniqueIndex("submitted_orders_run_client_order_id").on(table.runId, table.clientOrderId),
  ],
);

export const tradeFillsTable = sqliteTable(
  "trade_fills",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    submittedOrderId: text("submitted_order_id"),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    venueFillId: text("venue_fill_id").notNull(),
    venueOrderId: text("venue_order_id"),
    side: text("side").notNull(),
    price: real("price").notNull(),
    quantity: real("quantity").notNull(),
    fee: real("fee").notNull(),
    tradePnl: real("trade_pnl").notNull(),
    makerTaker: text("maker_taker").notNull(),
    filledAt: integer("filled_at").notNull(),
    rawJson: text("raw_json"),
  },
  (table) => [uniqueIndex("trade_fills_venue_fill_id").on(table.venue, table.venueFillId)],
);

export const accountStateObservationsTable = sqliteTable(
  "account_state_observations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    observedAt: integer("observed_at").notNull(),
    balance: real("balance"),
    equity: real("equity"),
    realizedPnl: real("realized_pnl"),
    unrealizedPnl: real("unrealized_pnl"),
    positionQty: real("position_qty"),
    marginRatio: real("margin_ratio"),
    rawJson: text("raw_json"),
  },
  (table) => [
    uniqueIndex("account_state_observations_run_market_observed_at").on(
      table.runId,
      table.market,
      table.observedAt,
    ),
  ],
);
