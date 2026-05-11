export const DEFAULT_DATABASE_URL = "file:data/mm.db";

export type ResolvedDatabaseUrl =
  | { kind: "sqlite"; path: string }
  | { kind: "postgres"; url: string };

export function resolveDatabaseUrl(databaseUrl: string | undefined): ResolvedDatabaseUrl {
  const value = databaseUrl?.trim() || DEFAULT_DATABASE_URL;

  if (value.startsWith("postgres://") || value.startsWith("postgresql://")) {
    return { kind: "postgres", url: value };
  }

  if (value.startsWith("file:")) {
    return { kind: "sqlite", path: sqlitePathFromFileUrl(value) };
  }

  throw new Error("Unsupported DATABASE_URL scheme. Use file:<path> or postgres://...");
}

export function resolveSqliteDatabasePath(databaseUrl: string | undefined): string {
  const resolved = resolveDatabaseUrl(databaseUrl);
  if (resolved.kind !== "sqlite") {
    throw new Error("This script requires a SQLite DATABASE_URL such as file:data/mm.db");
  }
  return resolved.path;
}

function sqlitePathFromFileUrl(databaseUrl: string): string {
  const rest = stripQueryAndHash(databaseUrl.slice("file:".length));

  if (rest.startsWith("///")) {
    return `/${rest.slice(3)}`;
  }

  if (rest.startsWith("//")) {
    throw new Error("SQLite DATABASE_URL must use file:<path> or file:///absolute/path");
  }

  return rest;
}

function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  const endIndex = indexes.length === 0 ? value.length : Math.min(...indexes);
  return value.slice(0, endIndex);
}
