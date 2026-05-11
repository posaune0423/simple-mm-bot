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

  test("adds edge discovery fact tables and analysis views", async () => {
    const migration = await Bun.file(
      "src/infrastructure/db/postgres/migrations/0004_edge_discovery_fact_tables.sql",
    ).text();

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS runtime_health_events");
    expect(migration).toContain("ALTER TABLE orderbook_snapshots");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS vamp_price DOUBLE PRECISION");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS quote_decisions");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS order_lifecycle_events");
    expect(migration).toContain("UNIQUE (run_id, quote_cycle_id, side, level)");
    expect(migration).toContain("DROP VIEW IF EXISTS v_fill_markouts");
    expect(migration).toContain("CREATE VIEW v_fill_context");
    expect(migration).toContain("CREATE VIEW v_edge_quote_bucket_quality");
    expect(migration).toContain("CREATE VIEW v_runtime_health_summary");
    expect(migration).toContain("quote_age_bucket");
    expect(migration).toContain("'<250ms'");
    expect(migration).toContain("'250-500ms'");
    expect(migration).toContain("'500-1000ms'");
    expect(migration).toContain("'1000-3000ms'");
    expect(migration).toContain("'3000ms+'");
    expect(migration).toContain("vw_markout_5s_bps");
    expect(migration).toContain("vw_markout_30s_bps");
    expect(migration).toContain("net_ev_bps");
  });

  test("adds average absolute inventory risk through a forward migration", async () => {
    const migration0002 = await Bun.file(
      "src/infrastructure/db/postgres/migrations/0002_metrics_fact_tables.sql",
    ).text();
    const migration0004 = await Bun.file(
      "src/infrastructure/db/postgres/migrations/0004_edge_discovery_fact_tables.sql",
    ).text();
    const migration0005 = await Bun.file(
      "src/infrastructure/db/postgres/migrations/0005_inventory_avg_abs_position.sql",
    ).text();

    expect(migration0002).not.toContain("AVG(abs_position) AS avg_abs_position");
    expect(migration0004).not.toContain("ir.avg_abs_position");
    expect(migration0005).toContain("DROP VIEW IF EXISTS v_run_performance");
    expect(migration0005).toContain("CREATE OR REPLACE VIEW v_inventory_risk");
    expect(migration0005).toContain("AVG(abs_position) AS avg_abs_position");
    expect(migration0005).toContain("ir.avg_abs_position");
  });
});
