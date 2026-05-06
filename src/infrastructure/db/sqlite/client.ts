import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema.ts";

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export function createSqliteClient(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS fills (
      id TEXT PRIMARY KEY,
      venue TEXT NOT NULL,
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      qty REAL NOT NULL,
      fee REAL NOT NULL,
      trade_pnl REAL NOT NULL,
      filled_at INTEGER NOT NULL,
      quote_id TEXT,
      mark_price_at_fill REAL,
      mark_price_5s REAL,
      mark_price_30s REAL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      venue TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      metrics_json TEXT NOT NULL,
      equity_curve_json TEXT NOT NULL,
      fill_analysis_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ohlcv (
      market TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      ts INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (market, timeframe, ts)
    );
    CREATE TABLE IF NOT EXISTS telemetry_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      venue TEXT NOT NULL,
      capital_mode TEXT NOT NULL,
      market TEXT NOT NULL,
      config_json TEXT NOT NULL,
      git_sha TEXT,
      git_dirty INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      venue TEXT NOT NULL,
      type TEXT NOT NULL,
      ts INTEGER NOT NULL,
      market TEXT,
      payload_json TEXT NOT NULL
    );
  `);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
