CREATE EXTENSION IF NOT EXISTS timescaledb;

DROP VIEW IF EXISTS analytics_quote_markouts;
DROP VIEW IF EXISTS analytics_fill_markouts;
DROP VIEW IF EXISTS v_run_performance;
DROP VIEW IF EXISTS v_inventory_risk;
DROP VIEW IF EXISTS v_fill_markouts;
DROP VIEW IF EXISTS v_order_lifecycle;
DROP VIEW IF EXISTS v_quote_competitiveness;
DROP VIEW IF EXISTS v_quote_level_quality;
DROP VIEW IF EXISTS v_fill_context;
DROP VIEW IF EXISTS v_edge_quote_bucket_quality;
DROP VIEW IF EXISTS v_runtime_health_summary;

DROP TABLE IF EXISTS target_market_order_books CASCADE;
DROP TABLE IF EXISTS target_market_trades CASCADE;
DROP TABLE IF EXISTS target_market_tickers CASCADE;
DROP TABLE IF EXISTS external_market_top_of_book CASCADE;
DROP TABLE IF EXISTS external_market_trades CASCADE;
DROP TABLE IF EXISTS external_market_tickers CASCADE;
DROP TABLE IF EXISTS bot_runs CASCADE;
DROP TABLE IF EXISTS bot_market_observations CASCADE;
DROP TABLE IF EXISTS bot_quote_decisions CASCADE;
DROP TABLE IF EXISTS bot_orders CASCADE;
DROP TABLE IF EXISTS bot_fills CASCADE;
DROP TABLE IF EXISTS trading_runs CASCADE;
DROP TABLE IF EXISTS orderbook_snapshots CASCADE;
DROP TABLE IF EXISTS submitted_orders CASCADE;
DROP TABLE IF EXISTS trade_fills CASCADE;
DROP TABLE IF EXISTS account_state_observations CASCADE;
DROP TABLE IF EXISTS runtime_health_events CASCADE;
DROP TABLE IF EXISTS quote_decisions CASCADE;
DROP TABLE IF EXISTS order_lifecycle_events CASCADE;
DROP TABLE IF EXISTS ohlcv CASCADE;

CREATE TABLE target_market_order_books (
  id TEXT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange_time BIGINT,
  received_at BIGINT NOT NULL,
  depth INTEGER NOT NULL,
  best_bid_price DOUBLE PRECISION NOT NULL,
  best_bid_size DOUBLE PRECISION NOT NULL,
  best_ask_price DOUBLE PRECISION NOT NULL,
  best_ask_size DOUBLE PRECISION NOT NULL,
  mid_price DOUBLE PRECISION NOT NULL,
  micro_price DOUBLE PRECISION,
  vamp_price DOUBLE PRECISION,
  spread_bps DOUBLE PRECISION NOT NULL,
  bids_json TEXT NOT NULL,
  asks_json TEXT NOT NULL,
  sequence TEXT,
  raw_json TEXT
);

CREATE UNIQUE INDEX md_book_id_received_at_idx
  ON target_market_order_books (id, received_at);
CREATE INDEX md_book_venue_symbol_received_at_idx
  ON target_market_order_books (venue, symbol, received_at);
CREATE INDEX md_book_symbol_received_at_idx
  ON target_market_order_books (symbol, received_at);

CREATE TABLE target_market_trades (
  id TEXT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  trade_id TEXT,
  exchange_time BIGINT,
  received_at BIGINT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  side TEXT,
  aggressor_side TEXT,
  raw_json TEXT
);

CREATE UNIQUE INDEX md_trades_id_received_at_idx
  ON target_market_trades (id, received_at);
CREATE INDEX md_trades_venue_symbol_received_at_idx
  ON target_market_trades (venue, symbol, received_at);
CREATE INDEX md_trades_symbol_received_at_idx
  ON target_market_trades (symbol, received_at);
CREATE UNIQUE INDEX md_trades_venue_trade_id_received_at_idx
  ON target_market_trades (venue, trade_id, received_at);

CREATE TABLE target_market_tickers (
  id TEXT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange_time BIGINT,
  received_at BIGINT NOT NULL,
  mark_price DOUBLE PRECISION,
  index_price DOUBLE PRECISION,
  last_price DOUBLE PRECISION,
  funding_rate DOUBLE PRECISION,
  open_interest DOUBLE PRECISION,
  raw_json TEXT
);

CREATE UNIQUE INDEX md_tickers_id_received_at_idx
  ON target_market_tickers (id, received_at);
CREATE INDEX md_tickers_venue_symbol_received_at_idx
  ON target_market_tickers (venue, symbol, received_at);
CREATE INDEX md_tickers_symbol_received_at_idx
  ON target_market_tickers (symbol, received_at);

CREATE TABLE external_market_top_of_book (
  id TEXT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange_time BIGINT,
  received_at BIGINT NOT NULL,
  bid_price DOUBLE PRECISION NOT NULL,
  bid_size DOUBLE PRECISION NOT NULL,
  ask_price DOUBLE PRECISION NOT NULL,
  ask_size DOUBLE PRECISION NOT NULL,
  mid_price DOUBLE PRECISION NOT NULL,
  micro_price DOUBLE PRECISION,
  spread_bps DOUBLE PRECISION NOT NULL,
  sequence TEXT,
  raw_json TEXT
);

CREATE UNIQUE INDEX external_tob_id_received_at_idx
  ON external_market_top_of_book (id, received_at);
CREATE INDEX external_tob_venue_symbol_received_at_idx
  ON external_market_top_of_book (venue, symbol, received_at);
CREATE INDEX external_tob_symbol_received_at_idx
  ON external_market_top_of_book (symbol, received_at);

CREATE TABLE external_market_trades (
  id TEXT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  trade_id TEXT,
  exchange_time BIGINT,
  received_at BIGINT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  side TEXT,
  aggressor_side TEXT,
  raw_json TEXT
);

CREATE UNIQUE INDEX external_trades_id_received_at_idx
  ON external_market_trades (id, received_at);
CREATE INDEX external_trades_venue_symbol_received_at_idx
  ON external_market_trades (venue, symbol, received_at);
CREATE INDEX external_trades_symbol_received_at_idx
  ON external_market_trades (symbol, received_at);
CREATE UNIQUE INDEX external_trades_venue_trade_id_received_at_idx
  ON external_market_trades (venue, trade_id, received_at);

CREATE TABLE external_market_tickers (
  id TEXT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange_time BIGINT,
  received_at BIGINT NOT NULL,
  mark_price DOUBLE PRECISION,
  index_price DOUBLE PRECISION,
  last_price DOUBLE PRECISION,
  funding_rate DOUBLE PRECISION,
  open_interest DOUBLE PRECISION,
  raw_json TEXT
);

CREATE UNIQUE INDEX external_tickers_id_received_at_idx
  ON external_market_tickers (id, received_at);
CREATE INDEX external_tickers_venue_symbol_received_at_idx
  ON external_market_tickers (venue, symbol, received_at);
CREATE INDEX external_tickers_symbol_received_at_idx
  ON external_market_tickers (symbol, received_at);

CREATE TABLE bot_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  strategy_version TEXT,
  config_hash TEXT NOT NULL,
  config_json TEXT NOT NULL,
  git_sha TEXT,
  git_dirty BOOLEAN NOT NULL DEFAULT FALSE,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  status TEXT NOT NULL,
  stop_reason TEXT,
  metadata_json TEXT
);

CREATE TABLE bot_market_observations (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  observed_at BIGINT NOT NULL,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  latest_book_snapshot_id TEXT,
  latest_ticker_id TEXT,
  latest_trade_id TEXT,
  local_mid DOUBLE PRECISION,
  local_micro DOUBLE PRECISION,
  local_vamp DOUBLE PRECISION,
  mark_price DOUBLE PRECISION,
  external_fair DOUBLE PRECISION,
  external_age_ms BIGINT,
  external_diff_bps DOUBLE PRECISION,
  position_qty DOUBLE PRECISION,
  inventory_notional DOUBLE PRECISION,
  context_json TEXT
);

CREATE UNIQUE INDEX bot_obs_id_observed_at_idx
  ON bot_market_observations (id, observed_at);
CREATE INDEX bot_obs_run_observed_at_idx
  ON bot_market_observations (run_id, observed_at);
CREATE INDEX bot_obs_run_symbol_observed_at_idx
  ON bot_market_observations (run_id, symbol, observed_at);

CREATE TABLE bot_quote_decisions (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  observation_id TEXT,
  decided_at BIGINT NOT NULL,
  quote_cycle_id TEXT,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  fair_price DOUBLE PRECISION NOT NULL,
  reservation_price DOUBLE PRECISION,
  reference_price DOUBLE PRECISION,
  sigma DOUBLE PRECISION,
  gamma DOUBLE PRECISION,
  kappa DOUBLE PRECISION,
  inventory_qty DOUBLE PRECISION,
  inventory_skew_bps DOUBLE PRECISION,
  bid_price DOUBLE PRECISION,
  bid_size DOUBLE PRECISION,
  ask_price DOUBLE PRECISION,
  ask_size DOUBLE PRECISION,
  bid_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ask_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  spread_bps DOUBLE PRECISION,
  half_spread_bps DOUBLE PRECISION,
  reason TEXT,
  decision_json TEXT
);

CREATE UNIQUE INDEX bot_quotes_id_decided_at_idx
  ON bot_quote_decisions (id, decided_at);
CREATE INDEX bot_quotes_run_decided_at_idx
  ON bot_quote_decisions (run_id, decided_at);
CREATE INDEX bot_quotes_run_symbol_decided_at_idx
  ON bot_quote_decisions (run_id, symbol, decided_at);

CREATE TABLE bot_orders (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  quote_decision_id TEXT,
  created_at BIGINT NOT NULL,
  submitted_at BIGINT,
  accepted_at BIGINT,
  canceled_at BIGINT,
  rejected_at BIGINT,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  client_order_id TEXT,
  venue_order_id TEXT,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  price DOUBLE PRECISION,
  quantity DOUBLE PRECISION NOT NULL,
  post_only BOOLEAN,
  reduce_only BOOLEAN,
  time_in_force TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  latency_ms BIGINT,
  raw_json TEXT
);

CREATE UNIQUE INDEX bot_orders_id_created_at_idx
  ON bot_orders (id, created_at);
CREATE INDEX bot_orders_run_created_at_idx
  ON bot_orders (run_id, created_at);
CREATE INDEX bot_orders_run_client_order_id_idx
  ON bot_orders (run_id, client_order_id);
CREATE INDEX bot_orders_run_venue_order_id_idx
  ON bot_orders (run_id, venue_order_id);

CREATE TABLE bot_fills (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  order_id TEXT,
  quote_decision_id TEXT,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  venue_fill_id TEXT,
  venue_order_id TEXT,
  client_order_id TEXT,
  filled_at BIGINT NOT NULL,
  received_at BIGINT,
  side TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  fee DOUBLE PRECISION,
  fee_asset TEXT,
  liquidity TEXT,
  raw_json TEXT
);

CREATE UNIQUE INDEX bot_fills_id_filled_at_idx
  ON bot_fills (id, filled_at);
CREATE INDEX bot_fills_run_filled_at_idx
  ON bot_fills (run_id, filled_at);
CREATE INDEX bot_fills_run_symbol_filled_at_idx
  ON bot_fills (run_id, symbol, filled_at);
CREATE INDEX bot_fills_venue_fill_id_idx
  ON bot_fills (venue, venue_fill_id);

SELECT create_hypertable(
  'target_market_order_books',
  'received_at',
  chunk_time_interval => 21600000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'target_market_trades',
  'received_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'target_market_tickers',
  'received_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'external_market_top_of_book',
  'received_at',
  chunk_time_interval => 21600000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'external_market_trades',
  'received_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'external_market_tickers',
  'received_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'bot_market_observations',
  'observed_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'bot_quote_decisions',
  'decided_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'bot_orders',
  'created_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'bot_fills',
  'filled_at',
  chunk_time_interval => 86400000,
  if_not_exists => TRUE
);

CREATE OR REPLACE FUNCTION epoch_ms_now()
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
  SELECT floor(extract(epoch from now()) * 1000)::BIGINT
$$;

SELECT set_integer_now_func('target_market_order_books', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('target_market_trades', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('target_market_tickers', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('external_market_top_of_book', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('external_market_trades', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('external_market_tickers', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('bot_market_observations', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('bot_quote_decisions', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('bot_orders', 'epoch_ms_now', replace_if_exists => TRUE);
SELECT set_integer_now_func('bot_fills', 'epoch_ms_now', replace_if_exists => TRUE);

SELECT add_retention_policy('external_market_top_of_book', drop_after => BIGINT '604800000', schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
SELECT add_retention_policy('external_market_trades', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('external_market_tickers', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('target_market_order_books', drop_after => BIGINT '1209600000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('target_market_trades', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('target_market_tickers', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('bot_market_observations', drop_after => BIGINT '7776000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('bot_quote_decisions', drop_after => BIGINT '7776000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('bot_orders', drop_after => BIGINT '7776000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('bot_fills', drop_after => BIGINT '7776000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);

CREATE OR REPLACE VIEW analytics_quote_markouts AS
SELECT
  q.id AS quote_decision_id,
  q.run_id,
  q.venue,
  q.symbol,
  h.horizon_ms,
  q.decided_at,
  future.received_at AS future_received_at,
  future.mid_price AS future_mid_price,
  CASE
    WHEN q.bid_price IS NOT NULL
      THEN ((future.mid_price - q.bid_price) / q.bid_price) * 10000
    ELSE NULL
  END AS bid_markout_bps,
  CASE
    WHEN q.ask_price IS NOT NULL
      THEN ((q.ask_price - future.mid_price) / q.ask_price) * 10000
    ELSE NULL
  END AS ask_markout_bps,
  ((future.mid_price - q.fair_price) / q.fair_price) * 10000
    AS center_error_bps
FROM bot_quote_decisions q
CROSS JOIN (
  VALUES
    (1000),
    (5000),
    (30000),
    (300000)
) AS h(horizon_ms)
JOIN LATERAL (
  SELECT
    ob.received_at,
    ob.mid_price
  FROM target_market_order_books ob
  WHERE ob.venue = q.venue
    AND ob.symbol = q.symbol
    AND ob.received_at >= q.decided_at + h.horizon_ms
  ORDER BY ob.received_at ASC
  LIMIT 1
) future ON TRUE;

CREATE OR REPLACE VIEW analytics_fill_markouts AS
SELECT
  f.id AS fill_id,
  f.run_id,
  f.venue,
  f.symbol,
  h.horizon_ms,
  f.filled_at,
  future.received_at AS future_received_at,
  future.mid_price AS future_mid_price,
  CASE
    WHEN f.side = 'buy'
      THEN ((future.mid_price - f.price) / f.price) * 10000
    WHEN f.side = 'sell'
      THEN ((f.price - future.mid_price) / f.price) * 10000
    ELSE NULL
  END AS markout_bps
FROM bot_fills f
CROSS JOIN (
  VALUES
    (1000),
    (5000),
    (30000),
    (300000)
) AS h(horizon_ms)
JOIN LATERAL (
  SELECT
    ob.received_at,
    ob.mid_price
  FROM target_market_order_books ob
  WHERE ob.venue = f.venue
    AND ob.symbol = f.symbol
    AND ob.received_at >= f.filled_at + h.horizon_ms
  ORDER BY ob.received_at ASC
  LIMIT 1
) future ON TRUE;
