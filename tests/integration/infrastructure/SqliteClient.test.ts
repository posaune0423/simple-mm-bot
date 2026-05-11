import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  SQLITE_TABLE_NAMES,
  SQLITE_VIEW_NAMES,
} from "../../../src/infrastructure/db/sqlite/bootstrap.ts";
import { createSqliteClient } from "../../../src/infrastructure/db/sqlite/client.ts";

describe("createSqliteClient", () => {
  const tempDir = join(process.cwd(), "tmp-tests-sqlite-client");
  const dbPath = join(tempDir, "client.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("enables WAL and busy timeout for concurrent runtime writes", () => {
    const client = createSqliteClient(dbPath);

    const journalMode = client.sqlite
      .query<{ journal_mode: string }, []>("PRAGMA journal_mode")
      .get();
    const busyTimeout = client.sqlite.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();

    expect(journalMode?.journal_mode).toBe("wal");
    expect(busyTimeout?.timeout).toBeGreaterThanOrEqual(5_000);
  });

  test("creates the documented metrics tables and analysis views", () => {
    const client = createSqliteClient(dbPath);
    try {
      const objects = client.sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
        )
        .all()
        .map((row) => row.name);

      for (const tableName of SQLITE_TABLE_NAMES) {
        expect(objects).toContain(tableName);
      }
      for (const viewName of SQLITE_VIEW_NAMES) {
        expect(objects).toContain(viewName);
      }
    } finally {
      client.sqlite.close();
    }
  });
});
