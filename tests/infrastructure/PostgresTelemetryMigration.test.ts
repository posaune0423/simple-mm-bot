import { describe, expect, test } from "bun:test";

describe("Postgres telemetry migration", () => {
  test("creates telemetry tables before Postgres telemetry writes are enabled", async () => {
    const migration = await Bun.file(
      "src/infrastructure/db/postgres/migrations/0001_add_telemetry.sql",
    ).text();

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS telemetry_runs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS telemetry_events");
    expect(migration).toContain("capital_mode TEXT NOT NULL");
    expect(migration).toContain("payload_json TEXT NOT NULL");
  });
});
