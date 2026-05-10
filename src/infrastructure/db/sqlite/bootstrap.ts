export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export const SQLITE_TABLE_NAMES = [
  "ohlcv",
  "trading_runs",
  "orderbook_snapshots",
  "submitted_orders",
  "trade_fills",
  "account_state_observations",
] as const;

export const SQLITE_VIEW_NAMES = [
  "v_run_pnl",
  "v_equity_curve",
  "v_run_drawdown",
  "v_order_lifecycle",
  "v_quote_competitiveness",
  "v_quote_level_quality",
  "v_order_quality",
  "v_fill_markouts",
  "v_markout_quality",
  "v_market_quality",
  "v_inventory_risk",
  "v_run_performance",
] as const;

export const SQLITE_BOOTSTRAP_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};

  CREATE TABLE IF NOT EXISTS ohlcv (
    market TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    ts INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (market, timeframe, ts)
  );
  CREATE TABLE IF NOT EXISTS trading_runs (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    venue TEXT NOT NULL,
    market TEXT NOT NULL,
    capital_mode TEXT NOT NULL,
    strategy_name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    git_sha TEXT,
    git_dirty INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    stop_reason TEXT
  );
  CREATE TABLE IF NOT EXISTS orderbook_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    market TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    best_bid REAL NOT NULL,
    best_ask REAL NOT NULL,
    mid_price REAL NOT NULL,
    micro_price REAL NOT NULL,
    mark_price REAL NOT NULL,
    spread_bps REAL NOT NULL,
    staleness_ms INTEGER NOT NULL,
    raw_json TEXT,
    UNIQUE (run_id, market, observed_at)
  );
  CREATE TABLE IF NOT EXISTS submitted_orders (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    market TEXT NOT NULL,
    client_order_id TEXT NOT NULL,
    venue_order_id TEXT,
    intent TEXT NOT NULL,
    side TEXT NOT NULL,
    order_type TEXT NOT NULL,
    limit_price REAL,
    quantity REAL NOT NULL,
    time_in_force TEXT NOT NULL,
    submitted_at INTEGER NOT NULL,
    accepted_at INTEGER,
    rejected_at INTEGER,
    canceled_at INTEGER,
    final_status TEXT NOT NULL,
    reject_reason TEXT,
    latency_ms INTEGER,
    raw_json TEXT,
    UNIQUE (run_id, client_order_id)
  );
  CREATE TABLE IF NOT EXISTS trade_fills (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    submitted_order_id TEXT,
    venue TEXT NOT NULL,
    market TEXT NOT NULL,
    venue_fill_id TEXT NOT NULL,
    venue_order_id TEXT,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    fee REAL NOT NULL,
    trade_pnl REAL NOT NULL,
    maker_taker TEXT NOT NULL,
    filled_at INTEGER NOT NULL,
    raw_json TEXT,
    UNIQUE (venue, venue_fill_id)
  );
  CREATE TABLE IF NOT EXISTS account_state_observations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    market TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    balance REAL,
    equity REAL,
    realized_pnl REAL,
    unrealized_pnl REAL,
    position_qty REAL,
    margin_ratio REAL,
    raw_json TEXT,
    UNIQUE (run_id, market, observed_at)
  );

  DROP VIEW IF EXISTS v_run_performance;
  DROP VIEW IF EXISTS v_inventory_risk;
  DROP VIEW IF EXISTS v_market_quality;
  DROP VIEW IF EXISTS v_markout_quality;
  DROP VIEW IF EXISTS v_fill_markouts;
  DROP VIEW IF EXISTS v_order_quality;
  DROP VIEW IF EXISTS v_quote_level_quality;
  DROP VIEW IF EXISTS v_quote_competitiveness;
  DROP VIEW IF EXISTS v_order_lifecycle;
  DROP VIEW IF EXISTS v_run_drawdown;
  DROP VIEW IF EXISTS v_equity_curve;
  DROP VIEW IF EXISTS v_run_pnl;

  CREATE VIEW IF NOT EXISTS v_run_pnl AS
    SELECT
      run_id,
      SUM(price * quantity) AS notional,
      SUM(fee) AS fee,
      SUM(trade_pnl) AS trade_pnl,
      SUM(trade_pnl - fee) AS net_pnl,
      CASE
        WHEN SUM(price * quantity) > 0 THEN SUM(trade_pnl - fee) / SUM(price * quantity)
        ELSE 0
      END AS pnl_per_notional
    FROM trade_fills
    GROUP BY run_id;
  CREATE VIEW IF NOT EXISTS v_equity_curve AS
    SELECT
      id AS fill_id,
      run_id,
      filled_at,
      SUM(trade_pnl - fee) OVER (
        PARTITION BY run_id
        ORDER BY filled_at, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cumulative_net_pnl
    FROM trade_fills;
  CREATE VIEW IF NOT EXISTS v_run_drawdown AS
    WITH peaks AS (
      SELECT
        run_id,
        cumulative_net_pnl,
        MAX(cumulative_net_pnl) OVER (
          PARTITION BY run_id
          ORDER BY filled_at, fill_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS peak_pnl
      FROM v_equity_curve
    )
    SELECT run_id, MAX(peak_pnl - cumulative_net_pnl) AS max_drawdown
    FROM peaks
    GROUP BY run_id;
  CREATE VIEW IF NOT EXISTS v_order_lifecycle AS
    WITH fill_links AS (
      SELECT run_id, submitted_order_id AS order_id, MIN(filled_at) AS filled_at
      FROM trade_fills
      WHERE submitted_order_id IS NOT NULL
      GROUP BY run_id, submitted_order_id
      UNION ALL
      SELECT f.run_id, o.id AS order_id, MIN(f.filled_at) AS filled_at
      FROM trade_fills f
      JOIN submitted_orders o
        ON o.run_id = f.run_id
       AND o.venue_order_id = f.venue_order_id
      WHERE f.venue_order_id IS NOT NULL
      GROUP BY f.run_id, o.id
    ),
    first_fills AS (
      SELECT run_id, order_id, MIN(filled_at) AS filled_at
      FROM fill_links
      GROUP BY run_id, order_id
    ),
    enriched AS (
      SELECT
        o.*,
        CASE
          WHEN instr(o.client_order_id, ':bid:') > 0 THEN substr(o.client_order_id, 1, instr(o.client_order_id, ':bid:') - 1)
          WHEN instr(o.client_order_id, ':ask:') > 0 THEN substr(o.client_order_id, 1, instr(o.client_order_id, ':ask:') - 1)
          WHEN o.client_order_id LIKE '%:bid' THEN substr(o.client_order_id, 1, length(o.client_order_id) - 4)
          WHEN o.client_order_id LIKE '%:ask' THEN substr(o.client_order_id, 1, length(o.client_order_id) - 4)
          ELSE o.client_order_id
        END AS quote_cycle_id,
        CASE
          WHEN instr(o.client_order_id, ':bid:') > 0 THEN CAST(substr(o.client_order_id, instr(o.client_order_id, ':bid:') + 5) AS INTEGER)
          WHEN instr(o.client_order_id, ':ask:') > 0 THEN CAST(substr(o.client_order_id, instr(o.client_order_id, ':ask:') + 5) AS INTEGER)
          WHEN o.client_order_id LIKE '%:bid' OR o.client_order_id LIKE '%:ask' THEN 0
          ELSE NULL
        END AS quote_level,
        ff.filled_at,
        CASE
          WHEN ff.filled_at IS NOT NULL THEN ff.filled_at
          WHEN o.canceled_at IS NOT NULL THEN o.canceled_at
          WHEN o.rejected_at IS NOT NULL THEN o.rejected_at
          ELSE NULL
        END AS terminal_at
      FROM submitted_orders o
      LEFT JOIN first_fills ff
        ON ff.run_id = o.run_id
       AND ff.order_id = o.id
    )
    SELECT
      *,
      CASE
        WHEN terminal_at IS NOT NULL THEN terminal_at - submitted_at
        ELSE NULL
      END AS live_ms,
      CASE
        WHEN final_status = 'canceled' AND filled_at IS NULL THEN 1
        ELSE 0
      END AS canceled_before_fill
    FROM enriched;
  CREATE VIEW IF NOT EXISTS v_quote_competitiveness AS
    SELECT
      q.id,
      q.run_id,
      q.venue,
      q.market,
      q.client_order_id,
      q.side,
      q.quote_cycle_id,
      q.quote_level,
      q.limit_price,
      q.quantity,
      q.submitted_at,
      s.observed_at AS snapshot_observed_at,
      s.best_bid,
      s.best_ask,
      s.mid_price,
      s.spread_bps AS market_spread_bps,
      CASE
        WHEN q.limit_price IS NULL OR s.mid_price IS NULL THEN NULL
        WHEN q.side = 'buy' THEN ((s.mid_price - q.limit_price) / s.mid_price) * 10000
        ELSE ((q.limit_price - s.mid_price) / s.mid_price) * 10000
      END AS distance_to_mid_bps,
      CASE
        WHEN q.limit_price IS NULL THEN NULL
        WHEN q.side = 'buy' AND s.best_bid > 0 THEN ((s.best_bid - q.limit_price) / s.best_bid) * 10000
        WHEN q.side = 'sell' AND s.best_ask > 0 THEN ((q.limit_price - s.best_ask) / s.best_ask) * 10000
        ELSE NULL
      END AS distance_to_best_bps
    FROM v_order_lifecycle q
    LEFT JOIN orderbook_snapshots s
      ON s.id = (
        SELECT prior.id
        FROM orderbook_snapshots prior
        WHERE prior.run_id = q.run_id
          AND prior.market = q.market
          AND prior.observed_at <= q.submitted_at
        ORDER BY prior.observed_at DESC
        LIMIT 1
      )
    WHERE q.intent = 'quote';
  CREATE VIEW IF NOT EXISTS v_quote_level_quality AS
    SELECT
      q.run_id,
      q.quote_level,
      COUNT(*) AS submitted_count,
      SUM(CASE WHEN q.final_status = 'rejected' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS reject_rate,
      SUM(CASE WHEN q.final_status = 'canceled' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS cancel_rate,
      SUM(CASE WHEN q.final_status = 'filled' OR q.filled_at IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS fill_rate,
      AVG(q.live_ms) AS avg_live_ms,
      AVG(c.distance_to_mid_bps) AS avg_distance_to_mid_bps,
      AVG(c.distance_to_best_bps) AS avg_distance_to_best_bps
    FROM v_order_lifecycle q
    LEFT JOIN v_quote_competitiveness c
      ON c.id = q.id
    WHERE q.intent = 'quote'
      AND q.quote_level IS NOT NULL
    GROUP BY q.run_id, q.quote_level;
  CREATE VIEW IF NOT EXISTS v_order_quality AS
    SELECT
      o.run_id,
      COUNT(*) AS submitted_count,
      SUM(CASE WHEN o.final_status = 'rejected' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS reject_rate,
      SUM(CASE WHEN o.final_status = 'canceled' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS cancel_rate,
      SUM(CASE WHEN o.final_status = 'filled' OR o.filled_at IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS fill_rate,
      SUM(o.canceled_before_fill) * 1.0 / COUNT(*) AS cancel_before_fill_rate,
      AVG(o.live_ms) AS avg_live_ms,
      AVG(o.latency_ms) AS avg_latency_ms
    FROM v_order_lifecycle o
    GROUP BY o.run_id;
  CREATE VIEW IF NOT EXISTS v_fill_markouts AS
    SELECT
      f.id AS fill_id,
      f.run_id,
      f.market,
      f.side,
      f.price,
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
    LEFT JOIN orderbook_snapshots s5
      ON s5.id = (
        SELECT next_s5.id
        FROM orderbook_snapshots next_s5
        WHERE next_s5.run_id = f.run_id
          AND next_s5.market = f.market
          AND next_s5.observed_at >= f.filled_at + 5000
          AND next_s5.observed_at <= f.filled_at + 10000
        ORDER BY next_s5.observed_at ASC
        LIMIT 1
      )
    LEFT JOIN orderbook_snapshots s30
      ON s30.id = (
        SELECT next_s30.id
        FROM orderbook_snapshots next_s30
        WHERE next_s30.run_id = f.run_id
          AND next_s30.market = f.market
          AND next_s30.observed_at >= f.filled_at + 30000
          AND next_s30.observed_at <= f.filled_at + 45000
        ORDER BY next_s30.observed_at ASC
        LIMIT 1
      )
    LEFT JOIN orderbook_snapshots s300
      ON s300.id = (
        SELECT next_s300.id
        FROM orderbook_snapshots next_s300
        WHERE next_s300.run_id = f.run_id
          AND next_s300.market = f.market
          AND next_s300.observed_at >= f.filled_at + 300000
          AND next_s300.observed_at <= f.filled_at + 330000
        ORDER BY next_s300.observed_at ASC
        LIMIT 1
      );
  CREATE VIEW IF NOT EXISTS v_markout_quality AS
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
      SUM(CASE WHEN f.markout_5s_bps IS NOT NULL THEN 1 ELSE 0 END) * 1.0 /
        NULLIF(
          SUM(CASE WHEN ls.latest_observed_at >= f.filled_at + 5000 THEN 1 ELSE 0 END),
          0
        ) AS markout_5s_coverage
    FROM v_fill_markouts f
    LEFT JOIN latest_snapshot ls
      ON ls.run_id = f.run_id
     AND ls.market = f.market
    GROUP BY f.run_id;
  CREATE VIEW IF NOT EXISTS v_market_quality AS
    WITH ranked AS (
      SELECT
        run_id,
        market,
        spread_bps,
        staleness_ms,
        ROW_NUMBER() OVER (
          PARTITION BY run_id, market
          ORDER BY spread_bps
        ) AS spread_rank,
        COUNT(*) OVER (
          PARTITION BY run_id, market
        ) AS spread_count
      FROM orderbook_snapshots
    )
    SELECT
      run_id,
      market,
      AVG(spread_bps) AS avg_spread_bps,
      MIN(
        CASE
          WHEN spread_rank >= CAST((spread_count * 95 + 99) / 100 AS INTEGER)
          THEN spread_bps
          ELSE NULL
        END
      ) AS p95_spread_bps,
      SUM(CASE WHEN staleness_ms > 1000 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS stale_rate,
      COUNT(*) AS observation_count
    FROM ranked
    GROUP BY run_id, market;
  CREATE VIEW IF NOT EXISTS v_inventory_risk AS
    WITH curve AS (
      SELECT
        run_id,
        observed_at,
        ABS(COALESCE(position_qty, 0)) AS abs_position,
        position_qty,
        margin_ratio,
        equity,
        MAX(equity) OVER (
          PARTITION BY run_id
          ORDER BY observed_at, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS peak_equity
      FROM account_state_observations
    )
    SELECT
      run_id,
      MAX(abs_position) AS max_abs_position,
      AVG(position_qty) AS avg_position,
      MIN(margin_ratio) AS min_margin_ratio,
      MAX(CASE
        WHEN equity IS NULL OR peak_equity IS NULL THEN 0
        ELSE peak_equity - equity
      END) AS equity_drawdown
    FROM curve
    GROUP BY run_id;
  CREATE VIEW IF NOT EXISTS v_run_performance AS
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
`;
