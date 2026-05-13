import { match, P } from "ts-pattern";

export const DEFAULT_DATABASE_URL = "file:data/mm.db";

export type ResolvedDatabaseUrl =
  | { kind: "sqlite"; path: string }
  | { kind: "postgres"; url: string };

export function resolveDatabaseUrl(databaseUrl: string | undefined): ResolvedDatabaseUrl {
  const value = databaseUrl?.trim() || DEFAULT_DATABASE_URL;

  return match(value)
    .with(
      P.when((value) => value.startsWith("postgres://") || value.startsWith("postgresql://")),
      (url) => ({ kind: "postgres" as const, url }),
    )
    .with(
      P.when((value) => value.startsWith("file:")),
      (url) => ({
        kind: "sqlite" as const,
        path: sqlitePathFromFileUrl(url),
      }),
    )
    .otherwise(() => {
      throw new Error("Unsupported DATABASE_URL scheme. Use file:<path> or postgres://...");
    });
}

export function resolveSqliteDatabasePath(databaseUrl: string | undefined): string {
  const resolved = resolveDatabaseUrl(databaseUrl);
  return match(resolved)
    .with({ kind: "sqlite" }, (resolved) => resolved.path)
    .with({ kind: "postgres" }, () => {
      throw new Error("This script requires a SQLite DATABASE_URL such as file:data/mm.db");
    })
    .exhaustive();
}

function sqlitePathFromFileUrl(databaseUrl: string): string {
  const rest = stripQueryAndHash(databaseUrl.slice("file:".length));

  return match(rest)
    .with(
      P.when((rest) => rest.startsWith("///")),
      (rest) => `/${rest.slice(3)}`,
    )
    .with(
      P.when((rest) => rest.startsWith("//")),
      () => {
        throw new Error("SQLite DATABASE_URL must use file:<path> or file:///absolute/path");
      },
    )
    .otherwise((rest) => rest);
}

function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  const endIndex = indexes.length === 0 ? value.length : Math.min(...indexes);
  return value.slice(0, endIndex);
}
