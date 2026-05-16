import { match, P } from "ts-pattern";

export const DEFAULT_DATABASE_URL = "postgresql://mm:mm@127.0.0.1:5432/mm_bot";

type ResolvedDatabaseUrl = { kind: "postgres"; url: string };

export function resolveDatabaseUrl(databaseUrl: string | undefined): ResolvedDatabaseUrl {
  const value = databaseUrl?.trim() || DEFAULT_DATABASE_URL;

  return match(value)
    .with(
      P.when((value) => value.startsWith("postgres://") || value.startsWith("postgresql://")),
      (url) => ({ kind: "postgres" as const, url }),
    )
    .otherwise(() => {
      throw new Error("Unsupported DATABASE_URL scheme. Use postgres:// or postgresql://.");
    });
}
