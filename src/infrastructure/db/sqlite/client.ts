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

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
