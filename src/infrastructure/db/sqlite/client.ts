import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema.ts";

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export function createSqliteClient(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
  `);
  sqlite.exec(`
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
    CREATE VIEW IF NOT EXISTS v_order_quality AS
      WITH filled_orders AS (
        SELECT DISTINCT run_id, submitted_order_id AS order_id
        FROM trade_fills
        WHERE submitted_order_id IS NOT NULL
        UNION
        SELECT DISTINCT f.run_id, o.id AS order_id
        FROM trade_fills f
        JOIN submitted_orders o
          ON o.run_id = f.run_id
         AND o.venue_order_id = f.venue_order_id
        WHERE f.venue_order_id IS NOT NULL
      )
      SELECT
        o.run_id,
        COUNT(*) AS submitted_count,
        SUM(CASE WHEN o.final_status = 'rejected' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS reject_rate,
        SUM(CASE WHEN o.final_status = 'canceled' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS cancel_rate,
        SUM(CASE WHEN o.final_status = 'filled' OR fo.order_id IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS fill_rate,
        AVG(o.latency_ms) AS avg_latency_ms
      FROM submitted_orders o
      LEFT JOIN filled_orders fo
        ON fo.run_id = o.run_id
       AND fo.order_id = o.id
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
  `);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
