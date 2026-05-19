import { describe, expect, test } from "bun:test";

const MIGRATION_PATH =
  "src/infrastructure/db/postgres/migrations/0000_timescale_market_data_foundation.sql";

describe("Timescale market data foundation migration", () => {
  test("creates the requested Timescale extension, tables, hypertables, and analytics views", async () => {
    const migration = await Bun.file(MIGRATION_PATH).text();

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS timescaledb");
    expect(migration).toContain("CREATE TABLE target_market_order_books");
    expect(migration).toContain("CREATE TABLE target_market_trades");
    expect(migration).toContain("CREATE TABLE target_market_tickers");
    expect(migration).toContain("CREATE TABLE external_market_top_of_book");
    expect(migration).toContain("CREATE TABLE external_market_trades");
    expect(migration).toContain("CREATE TABLE external_market_tickers");
    expect(migration).toContain("CREATE TABLE bot_runs");
    expect(migration).toContain("CREATE TABLE bot_market_observations");
    expect(migration).toContain("CREATE TABLE bot_quote_decisions");
    expect(migration).toContain("CREATE TABLE bot_orders");
    expect(migration).toContain("CREATE TABLE bot_fills");

    expect(migration).toContain("SELECT create_hypertable(");
    expect(migration).toContain("'target_market_order_books'");
    expect(migration).toContain("'target_market_trades'");
    expect(migration).toContain("'target_market_tickers'");
    expect(migration).toContain("'external_market_top_of_book'");
    expect(migration).toContain("'external_market_trades'");
    expect(migration).toContain("'external_market_tickers'");
    expect(migration).toContain("'bot_market_observations'");
    expect(migration).toContain("'bot_quote_decisions'");
    expect(migration).toContain("'bot_orders'");
    expect(migration).toContain("'bot_fills'");

    expect(migration).toContain("CREATE OR REPLACE VIEW analytics_quote_markouts");
    expect(migration).toContain("CREATE OR REPLACE VIEW analytics_fill_markouts");
    expect(migration).toContain("q.ask_price IS NOT NULL");
    expect(migration).toContain("ob.received_at >= q.decided_at + h.horizon_ms");
    expect(migration).toContain("ob.received_at >= f.filled_at + h.horizon_ms");
  });

  test("configures low-cost Timescale retention for hypertables", async () => {
    const migration = await Bun.file(MIGRATION_PATH).text();

    expect(migration).toContain("CREATE OR REPLACE FUNCTION epoch_ms_now()");
    expect(migration).toContain("SELECT set_integer_now_func('external_market_top_of_book'");
    expect(migration).toContain("SELECT add_retention_policy('external_market_top_of_book'");
    expect(migration).toContain("drop_after => BIGINT '604800000'");
    expect(migration).toContain("SELECT add_retention_policy('target_market_order_books'");
    expect(migration).toContain("drop_after => BIGINT '1209600000'");
    expect(migration).toContain("SELECT add_retention_policy('bot_quote_decisions'");
    expect(migration).toContain("drop_after => BIGINT '7776000000'");
  });

  test("does not recreate deferred schemas or legacy SQLite-era metric structures", async () => {
    const migration = await Bun.file(MIGRATION_PATH).text();

    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS feed_sessions");
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS feed_gaps");
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS order_events");
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS quote_markouts");
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS fill_markouts");
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS telemetry_events");
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS ohlcv");
    expect(migration).not.toContain("bot_marketbservations");
    expect(migration).not.toContain("IS NOTULL");
  });
});
