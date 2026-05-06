import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import type { Database } from "bun:sqlite";
import { ResultAsync } from "neverthrow";

import { createSqliteClient } from "../src/infrastructure/db/sqlite/client.ts";
import { DEFAULT_SQLITE_DB_PATH } from "../src/runtimePaths.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { createAppError, formatAppError, type AppError } from "../src/utils/errors.ts";
import { logger } from "../src/utils/logger.ts";

const DB_ARCHIVE_DIR = join("artifacts", "archive", "db-imported");
const IMPORT_TABLES = [
  {
    name: "ohlcv",
    columns: ["market", "timeframe", "ts", "open", "high", "low", "close", "volume"],
    scopedByRunId: false,
  },
  {
    name: "trading_runs",
    columns: [
      "id",
      "mode",
      "venue",
      "market",
      "capital_mode",
      "strategy_name",
      "config_json",
      "git_sha",
      "git_dirty",
      "started_at",
      "ended_at",
      "status",
      "stop_reason",
    ],
    scopedByRunId: false,
  },
  {
    name: "orderbook_snapshots",
    columns: [
      "id",
      "run_id",
      "venue",
      "market",
      "observed_at",
      "best_bid",
      "best_ask",
      "mid_price",
      "micro_price",
      "mark_price",
      "spread_bps",
      "staleness_ms",
      "raw_json",
    ],
    scopedByRunId: true,
  },
  {
    name: "submitted_orders",
    columns: [
      "id",
      "run_id",
      "venue",
      "market",
      "client_order_id",
      "venue_order_id",
      "intent",
      "side",
      "order_type",
      "limit_price",
      "quantity",
      "time_in_force",
      "submitted_at",
      "accepted_at",
      "rejected_at",
      "canceled_at",
      "final_status",
      "reject_reason",
      "latency_ms",
      "raw_json",
    ],
    scopedByRunId: true,
  },
  {
    name: "trade_fills",
    columns: [
      "id",
      "run_id",
      "submitted_order_id",
      "venue",
      "market",
      "venue_fill_id",
      "venue_order_id",
      "side",
      "price",
      "quantity",
      "fee",
      "trade_pnl",
      "maker_taker",
      "filled_at",
      "raw_json",
    ],
    scopedByRunId: true,
  },
  {
    name: "account_state_observations",
    columns: [
      "id",
      "run_id",
      "venue",
      "market",
      "observed_at",
      "balance",
      "equity",
      "realized_pnl",
      "unrealized_pnl",
      "position_qty",
      "margin_ratio",
      "raw_json",
    ],
    scopedByRunId: true,
  },
] as const;

export interface CompactLocalArtifactsOptions {
  rootDir?: string;
  targetDbPath?: string;
  apply?: boolean;
}

interface ImportCounts {
  importable: number;
  imported: number;
  skipped: number;
}

export interface CompactSourceSummary {
  path: string;
  movedTo?: string;
  runs: ImportCounts;
  rows: Record<string, ImportCounts>;
}

export interface CompactLocalArtifactsSummary {
  apply: boolean;
  targetDbPath: string;
  sources: CompactSourceSummary[];
}

export async function compactLocalArtifacts(
  options: CompactLocalArtifactsOptions = {},
): Promise<CompactLocalArtifactsSummary> {
  const rootDir = options.rootDir ?? process.cwd();
  const targetDbPath = options.targetDbPath ?? join(rootDir, DEFAULT_SQLITE_DB_PATH);
  const apply = options.apply ?? false;
  const sources = await discoverSourceDatabases(rootDir, targetDbPath);
  const target = createSqliteClient(targetDbPath);

  try {
    const summaries: CompactSourceSummary[] = [];
    for (const sourcePath of sources) {
      const summary = importSourceDatabase(target.sqlite, sourcePath, apply);
      if (apply) {
        summary.movedTo = await archiveDatabaseFile(rootDir, sourcePath);
      }
      summaries.push(summary);
    }
    return { apply, targetDbPath, sources: summaries };
  } finally {
    target.sqlite.close();
  }
}

async function discoverSourceDatabases(rootDir: string, targetDbPath: string): Promise<string[]> {
  const files = await walk(rootDir);
  return files
    .filter((path) => isImportCandidate(rootDir, path))
    .filter((path) => path !== targetDbPath)
    .sort();
}

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function isImportCandidate(rootDir: string, path: string): boolean {
  const relativePath = relative(rootDir, path);
  if (relativePath.startsWith(DB_ARCHIVE_DIR)) {
    return false;
  }
  if (relativePath.startsWith("artifacts/")) {
    const fileName = basename(path);
    return fileName === "loop.db" || fileName === "backtest.db";
  }
  if (relativePath.startsWith("data/")) {
    return /^live-loop.*\.db$/.test(basename(path));
  }
  return false;
}

function importSourceDatabase(
  targetDb: Database,
  sourcePath: string,
  apply: boolean,
): CompactSourceSummary {
  const rows: Record<string, ImportCounts> = {};
  let runs: ImportCounts = { importable: 0, imported: 0, skipped: 0 };

  targetDb.query("ATTACH DATABASE ? AS source").run(sourcePath);
  try {
    prepareImportRunIds(targetDb);
    runs = countRunImport(targetDb);
    for (const table of IMPORT_TABLES) {
      if (!sourceTableExists(targetDb, table.name)) {
        continue;
      }
      const importable = table.scopedByRunId
        ? countImportableScopedRows(targetDb, table.name)
        : countSourceRows(targetDb, table.name);
      const before = countTargetRows(targetDb, table.name);
      if (apply) {
        insertRows(targetDb, table.name, [...table.columns], table.scopedByRunId);
      }
      const after = countTargetRows(targetDb, table.name);
      const imported = apply ? after - before : 0;
      rows[table.name] = {
        importable,
        imported,
        skipped: Math.max(0, importable - imported),
      };
    }
    return { path: sourcePath, runs: apply ? (rows.trading_runs ?? runs) : runs, rows };
  } finally {
    targetDb.exec("DETACH DATABASE source");
  }
}

function prepareImportRunIds(db: Database): void {
  db.exec("DROP TABLE IF EXISTS temp.import_run_ids");
  db.exec("CREATE TEMP TABLE import_run_ids (run_id TEXT PRIMARY KEY)");
  if (!sourceTableExists(db, "trading_runs")) {
    return;
  }
  db.exec(`
    INSERT INTO temp.import_run_ids (run_id)
    SELECT s.id
    FROM source.trading_runs s
    WHERE NOT EXISTS (
      SELECT 1 FROM main.trading_runs t WHERE t.id = s.id
    )
  `);
}

function countRunImport(db: Database): ImportCounts {
  if (!sourceTableExists(db, "trading_runs")) {
    return { importable: 0, imported: 0, skipped: 0 };
  }
  const source = countSourceRows(db, "trading_runs");
  const importable =
    db
      .query<{ count: number }, []>(`
        SELECT COUNT(*) AS count
        FROM source.trading_runs s
        WHERE NOT EXISTS (
          SELECT 1 FROM main.trading_runs t WHERE t.id = s.id
        )
      `)
      .get()?.count ?? 0;
  return { importable, imported: 0, skipped: source - importable };
}

function sourceTableExists(db: Database, tableName: string): boolean {
  const row = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM source.sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(tableName);
  return row !== null;
}

function countSourceRows(db: Database, tableName: string): number {
  return (
    db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM source.${tableName}`).get()
      ?.count ?? 0
  );
}

function countImportableScopedRows(db: Database, tableName: string): number {
  return (
    db
      .query<{ count: number }, []>(`
        SELECT COUNT(*) AS count
        FROM source.${tableName}
        WHERE run_id IN (SELECT run_id FROM temp.import_run_ids)
      `)
      .get()?.count ?? 0
  );
}

function countTargetRows(db: Database, tableName: string): number {
  return (
    db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM main.${tableName}`).get()
      ?.count ?? 0
  );
}

function insertRows(
  db: Database,
  tableName: string,
  columns: string[],
  scopedByRunId: boolean,
): void {
  const columnSql = columns.join(", ");
  const whereSql = scopedByRunId ? "WHERE run_id IN (SELECT run_id FROM temp.import_run_ids)" : "";
  db.exec(`
    INSERT OR IGNORE INTO main.${tableName} (${columnSql})
    SELECT ${columnSql}
    FROM source.${tableName}
    ${whereSql}
  `);
}

async function archiveDatabaseFile(rootDir: string, sourcePath: string): Promise<string> {
  const destination = join(rootDir, DB_ARCHIVE_DIR, relative(rootDir, sourcePath));
  await moveFile(sourcePath, destination);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${sourcePath}${suffix}`;
    if (existsSync(sidecar)) {
      await moveFile(sidecar, `${destination}${suffix}`);
    }
  }
  return destination;
}

async function moveFile(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await rename(source, destination);
}

function parseOptions(argv: string[]): CompactLocalArtifactsOptions {
  const flags = parseFlagOptions(argv);
  return {
    rootDir: flags.root,
    targetDbPath: flags.db ?? flags["target-db"] ?? DEFAULT_SQLITE_DB_PATH,
    apply: flags.apply === "true",
  };
}

if (import.meta.main) {
  void ResultAsync.fromPromise(compactLocalArtifacts(parseOptions(Bun.argv.slice(2))), (error) =>
    createAppError("compact.failed", "Failed to compact local artifact databases", error),
  ).match(
    (summary) => logger.info(JSON.stringify(summary, null, 2)),
    (error: AppError) => {
      logger.error(formatAppError(error));
      process.exitCode = 1;
    },
  );
}
