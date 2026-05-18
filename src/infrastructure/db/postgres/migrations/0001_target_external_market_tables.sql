DROP VIEW IF EXISTS analytics_quote_markouts;
DROP VIEW IF EXISTS analytics_fill_markouts;

CREATE TABLE IF NOT EXISTS target_market_order_books (
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

CREATE UNIQUE INDEX IF NOT EXISTS md_book_id_received_at_idx
  ON target_market_order_books (id, received_at);
CREATE INDEX IF NOT EXISTS md_book_venue_symbol_received_at_idx
  ON target_market_order_books (venue, symbol, received_at);
CREATE INDEX IF NOT EXISTS md_book_symbol_received_at_idx
  ON target_market_order_books (symbol, received_at);

CREATE TABLE IF NOT EXISTS target_market_trades (
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

CREATE UNIQUE INDEX IF NOT EXISTS md_trades_id_received_at_idx
  ON target_market_trades (id, received_at);
CREATE INDEX IF NOT EXISTS md_trades_venue_symbol_received_at_idx
  ON target_market_trades (venue, symbol, received_at);
CREATE INDEX IF NOT EXISTS md_trades_symbol_received_at_idx
  ON target_market_trades (symbol, received_at);
CREATE UNIQUE INDEX IF NOT EXISTS md_trades_venue_trade_id_received_at_idx
  ON target_market_trades (venue, trade_id, received_at);

CREATE TABLE IF NOT EXISTS target_market_tickers (
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

CREATE UNIQUE INDEX IF NOT EXISTS md_tickers_id_received_at_idx
  ON target_market_tickers (id, received_at);
CREATE INDEX IF NOT EXISTS md_tickers_venue_symbol_received_at_idx
  ON target_market_tickers (venue, symbol, received_at);
CREATE INDEX IF NOT EXISTS md_tickers_symbol_received_at_idx
  ON target_market_tickers (symbol, received_at);

DO $$
BEGIN
  IF to_regclass('public.market_data_order_book_snapshots') IS NOT NULL THEN
    INSERT INTO target_market_order_books (
      id,
      venue,
      symbol,
      exchange_time,
      received_at,
      depth,
      best_bid_price,
      best_bid_size,
      best_ask_price,
      best_ask_size,
      mid_price,
      micro_price,
      vamp_price,
      spread_bps,
      bids_json,
      asks_json,
      sequence,
      raw_json
    )
    SELECT
      id,
      venue,
      symbol,
      exchange_time,
      received_at,
      depth,
      best_bid_price,
      best_bid_size,
      best_ask_price,
      best_ask_size,
      mid_price,
      micro_price,
      vamp_price,
      spread_bps,
      bids_json,
      asks_json,
      sequence,
      raw_json
    FROM market_data_order_book_snapshots
    ON CONFLICT DO NOTHING;

    DROP TABLE market_data_order_book_snapshots CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_data_trades') IS NOT NULL THEN
    INSERT INTO target_market_trades (
      id,
      venue,
      symbol,
      trade_id,
      exchange_time,
      received_at,
      price,
      quantity,
      side,
      aggressor_side,
      raw_json
    )
    SELECT
      id,
      venue,
      symbol,
      trade_id,
      exchange_time,
      received_at,
      price,
      quantity,
      side,
      aggressor_side,
      raw_json
    FROM market_data_trades
    ON CONFLICT DO NOTHING;

    DROP TABLE market_data_trades CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_data_tickers') IS NOT NULL THEN
    INSERT INTO target_market_tickers (
      id,
      venue,
      symbol,
      exchange_time,
      received_at,
      mark_price,
      index_price,
      last_price,
      funding_rate,
      open_interest,
      raw_json
    )
    SELECT
      id,
      venue,
      symbol,
      exchange_time,
      received_at,
      mark_price,
      index_price,
      last_price,
      funding_rate,
      open_interest,
      raw_json
    FROM market_data_tickers
    ON CONFLICT DO NOTHING;

    DROP TABLE market_data_tickers CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS external_market_top_of_book (
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

CREATE UNIQUE INDEX IF NOT EXISTS external_tob_id_received_at_idx
  ON external_market_top_of_book (id, received_at);
CREATE INDEX IF NOT EXISTS external_tob_venue_symbol_received_at_idx
  ON external_market_top_of_book (venue, symbol, received_at);
CREATE INDEX IF NOT EXISTS external_tob_symbol_received_at_idx
  ON external_market_top_of_book (symbol, received_at);

CREATE TABLE IF NOT EXISTS external_market_trades (
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

CREATE UNIQUE INDEX IF NOT EXISTS external_trades_id_received_at_idx
  ON external_market_trades (id, received_at);
CREATE INDEX IF NOT EXISTS external_trades_venue_symbol_received_at_idx
  ON external_market_trades (venue, symbol, received_at);
CREATE INDEX IF NOT EXISTS external_trades_symbol_received_at_idx
  ON external_market_trades (symbol, received_at);
CREATE UNIQUE INDEX IF NOT EXISTS external_trades_venue_trade_id_received_at_idx
  ON external_market_trades (venue, trade_id, received_at);

CREATE TABLE IF NOT EXISTS external_market_tickers (
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

CREATE UNIQUE INDEX IF NOT EXISTS external_tickers_id_received_at_idx
  ON external_market_tickers (id, received_at);
CREATE INDEX IF NOT EXISTS external_tickers_venue_symbol_received_at_idx
  ON external_market_tickers (venue, symbol, received_at);
CREATE INDEX IF NOT EXISTS external_tickers_symbol_received_at_idx
  ON external_market_tickers (symbol, received_at);

SELECT create_hypertable(
  'target_market_order_books',
  'received_at',
  chunk_time_interval => 21600000,
  migrate_data => TRUE,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'target_market_trades',
  'received_at',
  chunk_time_interval => 86400000,
  migrate_data => TRUE,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'target_market_tickers',
  'received_at',
  chunk_time_interval => 86400000,
  migrate_data => TRUE,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'external_market_top_of_book',
  'received_at',
  chunk_time_interval => 21600000,
  migrate_data => TRUE,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'external_market_trades',
  'received_at',
  chunk_time_interval => 86400000,
  migrate_data => TRUE,
  if_not_exists => TRUE
);
SELECT create_hypertable(
  'external_market_tickers',
  'received_at',
  chunk_time_interval => 86400000,
  migrate_data => TRUE,
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

SELECT add_retention_policy('external_market_top_of_book', drop_after => BIGINT '604800000', schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
SELECT add_retention_policy('external_market_trades', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('external_market_tickers', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('target_market_order_books', drop_after => BIGINT '1209600000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('target_market_trades', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('target_market_tickers', drop_after => BIGINT '2592000000', schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);

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
