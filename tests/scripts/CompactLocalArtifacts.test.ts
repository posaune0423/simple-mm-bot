import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { compactLocalArtifacts } from "../../scripts/compactLocalArtifacts.ts";
import { createSqliteClient } from "../../src/infrastructure/db/sqlite/client.ts";
import type { TradingRunFact } from "../../src/infrastructure/Metrics.ts";

describe("compactLocalArtifacts", () => {
  const tempDir = join(process.cwd(), "tmp-tests-compact-artifacts");
  const targetDb = join(tempDir, "data", "mm.db");

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("dry-run reports importable artifact DBs without moving files", async () => {
    const sourceDb = join(tempDir, "artifacts", "strategy-runs", "run-1", "loop.db");
    seedRun(sourceDb, run({ id: "source-run" }));

    const summary = await compactLocalArtifacts({
      rootDir: tempDir,
      targetDbPath: targetDb,
      apply: false,
    });

    expect(summary.apply).toBe(false);
    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]?.path).toBe(sourceDb);
    expect(summary.sources[0]?.runs.importable).toBe(1);
    expect(summary.sources[0]?.movedTo).toBeUndefined();
    expect(existsSync(sourceDb)).toBe(true);
  });

  test("apply imports new runs, skips duplicate run_id, and archives DB sidecars", async () => {
    const duplicate = run({ id: "duplicate-run" });
    const imported = run({ id: "imported-run" });
    seedRun(targetDb, duplicate);

    const sourceDb = join(tempDir, "artifacts", "strategy-runs", "run-2", "loop.db");
    seedRun(sourceDb, duplicate, imported);
    seedSubmittedOrder(sourceDb, {
      id: "duplicate-order",
      runId: "duplicate-run",
      clientOrderId: "duplicate-client-order",
    });
    seedSubmittedOrder(sourceDb, {
      id: "imported-order",
      runId: "imported-run",
      clientOrderId: "imported-client-order",
    });
    createValidSidecars(sourceDb);

    const summary = await compactLocalArtifacts({
      rootDir: tempDir,
      targetDbPath: targetDb,
      apply: true,
    });

    expect(summary.sources[0]?.runs.imported).toBe(1);
    expect(summary.sources[0]?.runs.skipped).toBe(1);
    expect(summary.sources[0]?.movedTo).toBe(
      join(
        tempDir,
        "artifacts",
        "archive",
        "db-imported",
        "artifacts",
        "strategy-runs",
        "run-2",
        "loop.db",
      ),
    );
    expect(existsSync(sourceDb)).toBe(false);
    expect(existsSync(`${sourceDb}-wal`)).toBe(false);
    expect(existsSync(`${sourceDb}-shm`)).toBe(false);

    const target = createSqliteClient(targetDb);
    try {
      const rows = target.sqlite
        .query<{ id: string }, []>("SELECT id FROM trading_runs ORDER BY id")
        .all()
        .map((row) => row.id);
      expect(rows).toEqual(["duplicate-run", "imported-run"]);
      const submittedOrderRunIds = target.sqlite
        .query<{ run_id: string }, []>("SELECT run_id FROM submitted_orders ORDER BY id")
        .all()
        .map((row) => row.run_id);
      expect(submittedOrderRunIds).toEqual(["imported-run"]);
    } finally {
      target.sqlite.close();
    }
  });
});

function createValidSidecars(dbPath: string): void {
  const db = new Database(dbPath, { create: true });
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      CREATE TABLE IF NOT EXISTS sidecar_touch (id TEXT PRIMARY KEY);
      INSERT OR IGNORE INTO sidecar_touch (id) VALUES ('sidecar');
    `);
  } finally {
    db.close();
  }
}

function seedSubmittedOrder(
  dbPath: string,
  input: { id: string; runId: string; clientOrderId: string },
): void {
  const client = createSqliteClient(dbPath);
  try {
    client.sqlite
      .prepare(
        `
          INSERT INTO submitted_orders (
            id,
            run_id,
            venue,
            market,
            client_order_id,
            venue_order_id,
            intent,
            side,
            order_type,
            limit_price,
            quantity,
            time_in_force,
            submitted_at,
            accepted_at,
            rejected_at,
            canceled_at,
            final_status,
            reject_reason,
            latency_ms,
            raw_json
          )
          VALUES (?, ?, 'bulk', 'BTC-USD', ?, NULL, 'quote', 'buy', 'limit', 100, 1, 'GTC', 1, NULL, NULL, NULL, 'submitted', NULL, NULL, NULL)
        `,
      )
      .run(input.id, input.runId, input.clientOrderId);
  } finally {
    client.sqlite.close();
  }
}

function seedRun(dbPath: string, ...runs: TradingRunFact[]): void {
  const client = createSqliteClient(dbPath);
  try {
    const insert = client.sqlite.prepare(`
      INSERT INTO trading_runs (
        id,
        mode,
        venue,
        market,
        capital_mode,
        strategy_name,
        config_json,
        git_sha,
        git_dirty,
        started_at,
        ended_at,
        status,
        stop_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const value of runs) {
      insert.run(
        value.id,
        value.mode,
        value.venue,
        value.market,
        value.capitalMode,
        value.strategyName,
        JSON.stringify(value.configJson),
        value.gitSha ?? null,
        value.gitDirty ? 1 : 0,
        value.startedAt,
        value.endedAt ?? null,
        value.status,
        value.stopReason ?? null,
      );
    }
  } finally {
    client.sqlite.close();
  }
}

function run(overrides: Partial<TradingRunFact>): TradingRunFact {
  return {
    id: "run-1",
    mode: "backtest",
    venue: "bulk",
    market: "BTC-USD",
    capitalMode: "backtest",
    strategyName: "avellaneda-stoikov",
    configJson: { test: true },
    gitDirty: false,
    startedAt: 1_771_459_200_000,
    status: "completed",
    ...overrides,
  };
}
