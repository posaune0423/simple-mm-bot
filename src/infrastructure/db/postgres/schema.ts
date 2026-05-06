import { bigint, boolean, doublePrecision, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

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

export const tradingRunsTable = pgTable("trading_runs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  venue: text("venue").notNull(),
  market: text("market").notNull(),
  capitalMode: text("capital_mode").notNull(),
  strategyName: text("strategy_name").notNull(),
  configJson: text("config_json").notNull(),
  gitSha: text("git_sha"),
  gitDirty: boolean("git_dirty").notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  endedAt: bigint("ended_at", { mode: "number" }),
  status: text("status").notNull(),
  stopReason: text("stop_reason"),
});

export const orderbookSnapshotsTable = pgTable(
  "orderbook_snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    observedAt: bigint("observed_at", { mode: "number" }).notNull(),
    bestBid: doublePrecision("best_bid").notNull(),
    bestAsk: doublePrecision("best_ask").notNull(),
    midPrice: doublePrecision("mid_price").notNull(),
    microPrice: doublePrecision("micro_price").notNull(),
    markPrice: doublePrecision("mark_price").notNull(),
    spreadBps: doublePrecision("spread_bps").notNull(),
    stalenessMs: bigint("staleness_ms", { mode: "number" }).notNull(),
    rawJson: text("raw_json"),
  },
  (table) => ({
    runMarketObservedAt: uniqueIndex("orderbook_snapshots_run_market_observed_at").on(
      table.runId,
      table.market,
      table.observedAt,
    ),
  }),
);

export const submittedOrdersTable = pgTable(
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
    limitPrice: doublePrecision("limit_price"),
    quantity: doublePrecision("quantity").notNull(),
    timeInForce: text("time_in_force").notNull(),
    submittedAt: bigint("submitted_at", { mode: "number" }).notNull(),
    acceptedAt: bigint("accepted_at", { mode: "number" }),
    rejectedAt: bigint("rejected_at", { mode: "number" }),
    canceledAt: bigint("canceled_at", { mode: "number" }),
    finalStatus: text("final_status").notNull(),
    rejectReason: text("reject_reason"),
    latencyMs: bigint("latency_ms", { mode: "number" }),
    rawJson: text("raw_json"),
  },
  (table) => ({
    runClientOrderId: uniqueIndex("submitted_orders_run_client_order_id").on(
      table.runId,
      table.clientOrderId,
    ),
  }),
);

export const tradeFillsTable = pgTable(
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
    price: doublePrecision("price").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    fee: doublePrecision("fee").notNull(),
    tradePnl: doublePrecision("trade_pnl").notNull(),
    makerTaker: text("maker_taker").notNull(),
    filledAt: bigint("filled_at", { mode: "number" }).notNull(),
    rawJson: text("raw_json"),
  },
  (table) => ({
    venueFillId: uniqueIndex("trade_fills_venue_fill_id").on(table.venue, table.venueFillId),
  }),
);

export const accountStateObservationsTable = pgTable(
  "account_state_observations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    observedAt: bigint("observed_at", { mode: "number" }).notNull(),
    balance: doublePrecision("balance"),
    equity: doublePrecision("equity"),
    realizedPnl: doublePrecision("realized_pnl"),
    unrealizedPnl: doublePrecision("unrealized_pnl"),
    positionQty: doublePrecision("position_qty"),
    marginRatio: doublePrecision("margin_ratio"),
    rawJson: text("raw_json"),
  },
  (table) => ({
    runMarketObservedAt: uniqueIndex("account_state_observations_run_market_observed_at").on(
      table.runId,
      table.market,
      table.observedAt,
    ),
  }),
);
