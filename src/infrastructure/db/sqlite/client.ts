import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema.ts";

export function createSqliteClient(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
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
  `);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
