import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    index("submitted_orders_run_venue_order_id").on(table.runId, table.venueOrderId),
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
  (table) => [
    uniqueIndex("trade_fills_venue_fill_id").on(table.venue, table.venueFillId),
    index("trade_fills_market_side_filled_at").on(table.market, table.side, table.filledAt),
    index("trade_fills_run_submitted_order_id").on(table.runId, table.submittedOrderId),
    index("trade_fills_run_venue_order_id").on(table.runId, table.venueOrderId),
  ],
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

export const runtimeHealthEventsTable = sqliteTable(
  "runtime_health_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    observedAt: integer("observed_at").notNull(),
    level: text("level").notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    rawJson: text("raw_json"),
  },
  (table) => [
    uniqueIndex("runtime_health_events_run_code_observed_at").on(
      table.runId,
      table.code,
      table.observedAt,
    ),
    index("runtime_health_events_run_code").on(table.runId, table.code),
  ],
);

export const quoteDecisionsTable = sqliteTable(
  "quote_decisions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    quoteCycleId: text("quote_cycle_id").notNull(),
    side: text("side").notNull(),
    level: integer("level").notNull(),
    intent: text("intent").notNull(),
    price: real("price").notNull(),
    quantity: real("quantity").notNull(),
    fairPrice: real("fair_price").notNull(),
    sigma: real("sigma").notNull(),
    policy: text("policy").notNull(),
    positionQty: real("position_qty").notNull(),
    midPrice: real("mid_price").notNull(),
    microPrice: real("micro_price").notNull(),
    markPrice: real("mark_price").notNull(),
    spreadBps: real("spread_bps").notNull(),
    stalenessMs: integer("staleness_ms").notNull(),
    controlReasonsJson: text("control_reasons_json").notNull(),
    createdAt: integer("created_at").notNull(),
    rawJson: text("raw_json"),
  },
  (table) => [
    uniqueIndex("quote_decisions_run_cycle_side_level").on(
      table.runId,
      table.quoteCycleId,
      table.side,
      table.level,
    ),
    index("quote_decisions_run_market_created_at").on(table.runId, table.market, table.createdAt),
  ],
);

export const orderLifecycleEventsTable = sqliteTable(
  "order_lifecycle_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    action: text("action").notNull(),
    clientOrderId: text("client_order_id"),
    venueOrderId: text("venue_order_id"),
    side: text("side"),
    intent: text("intent"),
    orderType: text("order_type"),
    price: real("price"),
    quantity: real("quantity"),
    timeInForce: text("time_in_force"),
    status: text("status"),
    latencyMs: integer("latency_ms"),
    observedAt: integer("observed_at").notNull(),
    rawJson: text("raw_json"),
  },
  (table) => [
    index("order_lifecycle_events_run_client_order_id").on(table.runId, table.clientOrderId),
    index("order_lifecycle_events_run_venue_order_id").on(table.runId, table.venueOrderId),
  ],
);
