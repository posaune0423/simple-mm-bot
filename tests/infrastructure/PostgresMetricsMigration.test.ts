import { describe, expect, test } from "bun:test";

describe("Postgres metrics migration", () => {
  test("creates v5 fact tables and drops the generic telemetry event table", async () => {
    const migration = await Bun.file(
      "src/infrastructure/db/postgres/migrations/0002_metrics_fact_tables.sql",
    ).text();

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS trading_runs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS orderbook_snapshots");
    expect(migration).toContain("vamp_price DOUBLE PRECISION");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS submitted_orders");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS trade_fills");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS account_state_observations");
    expect(migration).toContain("UNIQUE (run_id, market, observed_at)");
    expect(migration).toContain("UNIQUE (venue, venue_fill_id)");
    expect(migration).toContain("DROP TABLE IF EXISTS reports");
    expect(migration).toContain("DROP TABLE IF EXISTS telemetry_events");
    expect(migration).toContain("CREATE OR REPLACE VIEW v_order_lifecycle");
    expect(migration).toContain("CREATE OR REPLACE VIEW v_quote_competitiveness");
    expect(migration).toContain("CREATE OR REPLACE VIEW v_quote_level_quality");
    expect(migration).toContain("cancel_before_fill_rate");
    expect(migration).toContain("avg_live_ms");
    expect(migration).toContain("CREATE OR REPLACE VIEW v_fill_markouts");
    expect(migration).toContain("LEFT JOIN LATERAL");
    expect(migration).toContain("next_s5.observed_at >= f.filled_at + 5000");
    expect(migration).toContain("next_s5.observed_at <= f.filled_at + 10000");
    expect(migration).toContain("next_s30.observed_at <= f.filled_at + 45000");
    expect(migration).toContain("next_s300.observed_at <= f.filled_at + 330000");
    expect(migration).toContain("WITH latest_snapshot AS");
    expect(migration).toContain("ls.latest_observed_at >= f.filled_at + 5000");
    expect(migration).not.toContain("s5.observed_at = f.filled_at + 5000");
    expect(migration).not.toContain("ohlcv");
  });

  test("adds nullable VAMP price to existing orderbook snapshot tables", async () => {
    const migration = await Bun.file(
      "src/infrastructure/db/postgres/migrations/0003_add_vamp_price_to_orderbook_snapshots.sql",
    ).text();

    expect(migration).toContain("ALTER TABLE orderbook_snapshots");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS vamp_price DOUBLE PRECISION");
  });
});
