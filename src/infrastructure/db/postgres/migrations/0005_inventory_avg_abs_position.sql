DROP VIEW IF EXISTS v_run_performance;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_inventory_risk AS
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
    AVG(abs_position) AS avg_abs_position,
    AVG(position_qty) AS avg_position,
    MIN(margin_ratio) AS min_margin_ratio,
    MAX(CASE
      WHEN equity IS NULL OR peak_equity IS NULL THEN 0
      ELSE peak_equity - equity
    END) AS equity_drawdown
  FROM curve
  GROUP BY run_id;
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
    ir.avg_abs_position,
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
