import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DATABASE_URL,
  resolveDatabaseUrl,
  resolveSqliteDatabasePath,
} from "../../../src/utils/databaseUrl.ts";

describe("databaseUrl", () => {
  test("defaults to the shared local SQLite database through DATABASE_URL", () => {
    expect(DEFAULT_DATABASE_URL).toBe("file:data/mm.db");
    expect(resolveDatabaseUrl(undefined)).toEqual({ kind: "sqlite", path: "data/mm.db" });
    expect(resolveDatabaseUrl("")).toEqual({ kind: "sqlite", path: "data/mm.db" });
  });

  test("detects PostgreSQL URLs", () => {
    expect(resolveDatabaseUrl("postgres://user:pass@localhost:5432/mm")).toEqual({
      kind: "postgres",
      url: "postgres://user:pass@localhost:5432/mm",
    });
    expect(resolveDatabaseUrl("postgresql://user:pass@localhost:5432/mm")).toEqual({
      kind: "postgres",
      url: "postgresql://user:pass@localhost:5432/mm",
    });
  });

  test("detects SQLite file URLs", () => {
    expect(resolveDatabaseUrl("file:data/mm.db")).toEqual({ kind: "sqlite", path: "data/mm.db" });
    expect(resolveDatabaseUrl("file:/tmp/mm.db")).toEqual({
      kind: "sqlite",
      path: "/tmp/mm.db",
    });
    expect(resolveDatabaseUrl("file:///tmp/mm.db")).toEqual({
      kind: "sqlite",
      path: "/tmp/mm.db",
    });
  });

  test("rejects unsupported or missing DATABASE_URL schemes", () => {
    expect(() => resolveDatabaseUrl("tmp/mm.db")).toThrow("Unsupported DATABASE_URL scheme");
    expect(() => resolveDatabaseUrl("mysql://localhost/mm")).toThrow(
      "Unsupported DATABASE_URL scheme",
    );
    expect(() => resolveDatabaseUrl("file://localhost/tmp/mm.db")).toThrow(
      "SQLite DATABASE_URL must use file:<path> or file:///absolute/path",
    );
  });

  test("returns a SQLite path for SQLite-only scripts", () => {
    expect(resolveSqliteDatabasePath("file:data/mm.db")).toBe("data/mm.db");
    expect(() => resolveSqliteDatabasePath("postgres://localhost/mm")).toThrow(
      "This script requires a SQLite DATABASE_URL",
    );
  });
});
