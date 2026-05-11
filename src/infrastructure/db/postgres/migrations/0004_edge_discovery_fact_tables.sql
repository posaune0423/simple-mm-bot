ALTER TABLE orderbook_snapshots
  ADD COLUMN IF NOT EXISTS vamp_price DOUBLE PRECISION;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS runtime_health_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  market TEXT NOT NULL,
  observed_at BIGINT NOT NULL,
  level TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  raw_json TEXT,
  UNIQUE (run_id, code, observed_at)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runtime_health_events_run_code
  ON runtime_health_events (run_id, code);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS quote_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  market TEXT NOT NULL,
  quote_cycle_id TEXT NOT NULL,
  side TEXT NOT NULL,
  level INTEGER NOT NULL,
  intent TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  fair_price DOUBLE PRECISION NOT NULL,
  sigma DOUBLE PRECISION NOT NULL,
  policy TEXT NOT NULL,
  position_qty DOUBLE PRECISION NOT NULL,
  mid_price DOUBLE PRECISION NOT NULL,
  micro_price DOUBLE PRECISION NOT NULL,
  mark_price DOUBLE PRECISION NOT NULL,
  spread_bps DOUBLE PRECISION NOT NULL,
  staleness_ms BIGINT NOT NULL,
  control_reasons_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  raw_json TEXT,
  UNIQUE (run_id, quote_cycle_id, side, level)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_decisions_run_market_created_at
  ON quote_decisions (run_id, market, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS order_lifecycle_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  market TEXT NOT NULL,
  action TEXT NOT NULL,
  client_order_id TEXT,
  venue_order_id TEXT,
  side TEXT,
  intent TEXT,
  order_type TEXT,
  price DOUBLE PRECISION,
  quantity DOUBLE PRECISION,
  time_in_force TEXT,
  status TEXT,
  latency_ms BIGINT,
  observed_at BIGINT NOT NULL,
  raw_json TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_lifecycle_events_run_client_order_id
  ON order_lifecycle_events (run_id, client_order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_lifecycle_events_run_venue_order_id
  ON order_lifecycle_events (run_id, venue_order_id);
--> statement-breakpoint
DROP VIEW IF EXISTS v_run_performance;
--> statement-breakpoint
DROP VIEW IF EXISTS v_runtime_health_summary;
--> statement-breakpoint
DROP VIEW IF EXISTS v_markout_quality;
--> statement-breakpoint
DROP VIEW IF EXISTS v_edge_quote_bucket_quality;
--> statement-breakpoint
DROP VIEW IF EXISTS v_fill_context;
--> statement-breakpoint
DROP VIEW IF EXISTS v_fill_markouts;
--> statement-breakpoint
CREATE VIEW v_fill_markouts AS
  SELECT
    f.id AS fill_id,
    f.run_id,
    f.market,
    f.side,
    f.price,
    f.quantity,
    f.fee,
    f.trade_pnl,
    f.maker_taker,
    f.submitted_order_id,
    f.venue_order_id,
    f.filled_at,
    s5.mid_price AS mid_5s,
    CASE
      WHEN s5.mid_price IS NULL THEN NULL
      WHEN f.side = 'buy' THEN ((s5.mid_price - f.price) / f.price) * 10000
      ELSE ((f.price - s5.mid_price) / f.price) * 10000
    END AS markout_5s_bps,
    CASE
      WHEN s5.mid_price IS NULL THEN NULL
      WHEN f.side = 'buy' AND s5.mid_price < f.price THEN 1
      WHEN f.side = 'sell' AND s5.mid_price > f.price THEN 1
      ELSE 0
    END AS adverse_5s,
    s30.mid_price AS mid_30s,
    CASE
      WHEN s30.mid_price IS NULL THEN NULL
      WHEN f.side = 'buy' THEN ((s30.mid_price - f.price) / f.price) * 10000
      ELSE ((f.price - s30.mid_price) / f.price) * 10000
    END AS markout_30s_bps,
    s300.mid_price AS mid_300s,
    CASE
      WHEN s300.mid_price IS NULL THEN NULL
      WHEN f.side = 'buy' THEN ((s300.mid_price - f.price) / f.price) * 10000
      ELSE ((f.price - s300.mid_price) / f.price) * 10000
    END AS markout_300s_bps
  FROM trade_fills f
  LEFT JOIN LATERAL (
    SELECT mid_price
    FROM orderbook_snapshots next_s5
    WHERE next_s5.run_id = f.run_id
      AND next_s5.market = f.market
      AND next_s5.observed_at >= f.filled_at + 5000
      AND next_s5.observed_at <= f.filled_at + 10000
    ORDER BY next_s5.observed_at ASC
    LIMIT 1
  ) s5 ON true
  LEFT JOIN LATERAL (
    SELECT mid_price
    FROM orderbook_snapshots next_s30
    WHERE next_s30.run_id = f.run_id
      AND next_s30.market = f.market
      AND next_s30.observed_at >= f.filled_at + 30000
      AND next_s30.observed_at <= f.filled_at + 45000
    ORDER BY next_s30.observed_at ASC
    LIMIT 1
  ) s30 ON true
  LEFT JOIN LATERAL (
    SELECT mid_price
    FROM orderbook_snapshots next_s300
    WHERE next_s300.run_id = f.run_id
      AND next_s300.market = f.market
      AND next_s300.observed_at >= f.filled_at + 300000
      AND next_s300.observed_at <= f.filled_at + 330000
    ORDER BY next_s300.observed_at ASC
    LIMIT 1
  ) s300 ON true;
--> statement-breakpoint
CREATE VIEW v_fill_context AS
  SELECT
    m.fill_id,
    m.run_id,
    m.market,
    m.side,
    m.price,
    m.quantity,
    m.fee,
    m.trade_pnl,
    m.maker_taker,
    m.submitted_order_id,
    m.venue_order_id,
    m.filled_at,
    m.mid_5s,
    m.markout_5s_bps,
    m.adverse_5s,
    m.mid_30s,
    m.markout_30s_bps,
    m.mid_300s,
    m.markout_300s_bps,
    o.id AS submitted_order_row_id,
    o.client_order_id,
    o.intent AS order_intent,
    o.time_in_force,
    o.quote_cycle_id,
    o.quote_level,
    q.id AS quote_decision_id,
    q.intent AS quote_intent,
    q.price AS quote_price,
    q.quantity AS quote_quantity,
    q.fair_price,
    q.sigma,
    q.policy,
    q.position_qty,
    q.mid_price AS quote_mid_price,
    q.micro_price AS quote_micro_price,
    q.mark_price AS quote_mark_price,
    q.spread_bps AS quote_spread_bps,
    q.staleness_ms AS quote_staleness_ms,
    q.control_reasons_json,
    q.created_at AS quote_created_at,
    CASE
      WHEN q.created_at IS NULL THEN NULL
      ELSE m.filled_at - q.created_at
    END AS quote_age_ms,
    CASE
      WHEN m.price * m.quantity > 0 THEN ((m.trade_pnl - m.fee) / (m.price * m.quantity)) * 10000
      ELSE NULL
    END AS net_ev_bps
  FROM v_fill_markouts m
  LEFT JOIN v_order_lifecycle o
    ON o.run_id = m.run_id
   AND (
     o.id = m.submitted_order_id
     OR (m.venue_order_id IS NOT NULL AND o.venue_order_id = m.venue_order_id)
   )
  LEFT JOIN quote_decisions q
    ON q.run_id = m.run_id
   AND q.market = m.market
   AND q.quote_cycle_id = o.quote_cycle_id
   AND q.side = o.side
   AND q.level = o.quote_level;
--> statement-breakpoint
CREATE VIEW v_edge_quote_bucket_quality AS
  WITH bucketed AS (
    SELECT
      *,
      CASE
        WHEN quote_age_ms IS NULL THEN 'unknown'
        WHEN quote_age_ms < 250 THEN '<250ms'
        WHEN quote_age_ms < 500 THEN '250-500ms'
        WHEN quote_age_ms < 1000 THEN '500-1000ms'
        WHEN quote_age_ms < 3000 THEN '1000-3000ms'
        ELSE '3000ms+'
      END AS quote_age_bucket
    FROM v_fill_context
  )
  SELECT
    run_id,
    market,
    side,
    quote_level AS level,
    COALESCE(quote_intent, order_intent) AS intent,
    quote_age_bucket,
    COUNT(*) AS fill_count,
    SUM(price * quantity) AS notional,
    SUM(fee) AS fee,
    SUM(trade_pnl) AS trade_pnl,
    SUM(trade_pnl - fee) AS net_pnl,
    AVG(markout_5s_bps) AS avg_markout_5s_bps,
    AVG(markout_30s_bps) AS avg_markout_30s_bps,
    AVG(markout_300s_bps) AS avg_markout_300s_bps,
    SUM(markout_5s_bps * price * quantity) / NULLIF(SUM(CASE WHEN markout_5s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0) AS vw_markout_5s_bps,
    SUM(markout_30s_bps * price * quantity) / NULLIF(SUM(CASE WHEN markout_30s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0) AS vw_markout_30s_bps,
    SUM(markout_300s_bps * price * quantity) / NULLIF(SUM(CASE WHEN markout_300s_bps IS NOT NULL THEN price * quantity ELSE 0 END), 0) AS vw_markout_300s_bps,
    CASE
      WHEN SUM(price * quantity) > 0 THEN (SUM(trade_pnl - fee) / SUM(price * quantity)) * 10000
      ELSE NULL
    END AS net_ev_bps
  FROM bucketed
  GROUP BY
    run_id,
    market,
    side,
    quote_level,
    COALESCE(quote_intent, order_intent),
    quote_age_bucket;
--> statement-breakpoint
CREATE VIEW v_markout_quality AS
  WITH latest_snapshot AS (
    SELECT
      run_id,
      market,
      MAX(observed_at) AS latest_observed_at
    FROM orderbook_snapshots
    GROUP BY run_id, market
  )
  SELECT
    f.run_id,
    AVG(f.markout_5s_bps) AS avg_markout_5s_bps,
    AVG(f.adverse_5s) AS adverse_selection_rate_5s,
    SUM(CASE WHEN f.markout_5s_bps IS NOT NULL THEN 1 ELSE 0 END)::DOUBLE PRECISION /
      NULLIF(
        SUM(CASE WHEN ls.latest_observed_at >= f.filled_at + 5000 THEN 1 ELSE 0 END),
        0
      ) AS markout_5s_coverage
  FROM v_fill_markouts f
  LEFT JOIN latest_snapshot ls
    ON ls.run_id = f.run_id
   AND ls.market = f.market
  GROUP BY f.run_id;
--> statement-breakpoint
CREATE VIEW v_runtime_health_summary AS
  SELECT
    run_id,
    venue,
    market,
    level,
    code,
    COUNT(*) AS event_count,
    MAX(observed_at) AS latest_observed_at
  FROM runtime_health_events
  GROUP BY run_id, venue, market, level, code;
--> statement-breakpoint
CREATE VIEW v_run_performance AS
  SELECT
    r.id AS run_id,
    r.mode,
    r.venue,
    r.market,
    r.capital_mode,
    r.strategy_name,
    r.started_at,
    r.ended_at,
    r.status,
    p.notional,
    p.fee,
    p.trade_pnl,
    p.net_pnl,
    p.pnl_per_notional,
    d.max_drawdown,
    oq.submitted_count,
    oq.reject_rate,
    oq.cancel_rate,
    oq.fill_rate,
    oq.cancel_before_fill_rate,
    oq.avg_live_ms,
    oq.avg_latency_ms,
    mq.avg_markout_5s_bps,
    mq.adverse_selection_rate_5s,
    mq.markout_5s_coverage,
    mk.avg_spread_bps,
    mk.p95_spread_bps,
    mk.stale_rate,
    ir.max_abs_position,
    ir.avg_position,
    ir.min_margin_ratio,
    ir.equity_drawdown
  FROM trading_runs r
  LEFT JOIN v_run_pnl p ON p.run_id = r.id
  LEFT JOIN v_run_drawdown d ON d.run_id = r.id
  LEFT JOIN v_order_quality oq ON oq.run_id = r.id
  LEFT JOIN v_markout_quality mq ON mq.run_id = r.id
  LEFT JOIN v_market_quality mk ON mk.run_id = r.id AND mk.market = r.market
  LEFT JOIN v_inventory_risk ir ON ir.run_id = r.id;
