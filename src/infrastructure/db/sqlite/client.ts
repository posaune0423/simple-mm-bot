import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { SQLITE_BOOTSTRAP_SQL } from "./bootstrap.ts";
import * as schema from "./schema.ts";

export function createSqliteClient(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  sqlite.exec(SQLITE_BOOTSTRAP_SQL);
  ensureColumn(sqlite, "orderbook_snapshots", "vamp_price", "REAL");

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}

function ensureColumn(sqlite: Database, table: string, column: string, type: string): void {
  const columns = sqlite
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);
  if (!columns.includes(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
