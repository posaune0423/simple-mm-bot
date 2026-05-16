import { describe, expect, test } from "bun:test";

const MIGRATION_PATH =
  "src/infrastructure/db/postgres/migrations/0000_timescale_market_data_foundation.sql";

describe("Timescale market data foundation migration", () => {
  test("creates the requested Timescale extension, tables, hypertables, and analytics views", async () => {
    const migration = await Bun.file(MIGRATION_PATH).text();

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS timescaledb");
    expect(migration).toContain("CREATE TABLE market_data_order_book_snapshots");
    expect(migration).toContain("CREATE TABLE market_data_trades");
    expect(migration).toContain("CREATE TABLE market_data_tickers");
    expect(migration).toContain("CREATE TABLE bot_runs");
    expect(migration).toContain("CREATE TABLE bot_market_observations");
    expect(migration).toContain("CREATE TABLE bot_quote_decisions");
    expect(migration).toContain("CREATE TABLE bot_orders");
    expect(migration).toContain("CREATE TABLE bot_fills");

    expect(migration).toContain("SELECT create_hypertable(");
    expect(migration).toContain("'market_data_order_book_snapshots'");
    expect(migration).toContain("'market_data_trades'");
    expect(migration).toContain("'market_data_tickers'");
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
