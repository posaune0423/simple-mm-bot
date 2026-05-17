import { describe, expect, test } from "bun:test";

import { DEFAULT_DATABASE_URL, resolveDatabaseUrl } from "../../../src/utils/databaseUrl.ts";

describe("databaseUrl", () => {
  test("defaults to the local TimescaleDB/PostgreSQL database through DATABASE_URL", () => {
    expect(DEFAULT_DATABASE_URL).toBe("postgresql://mm:mm@127.0.0.1:5432/mm_bot");
    expect(resolveDatabaseUrl(undefined)).toEqual({
      kind: "postgres",
      url: "postgresql://mm:mm@127.0.0.1:5432/mm_bot",
    });
    expect(resolveDatabaseUrl("")).toEqual({
      kind: "postgres",
      url: "postgresql://mm:mm@127.0.0.1:5432/mm_bot",
    });
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

  test("rejects unsupported DATABASE_URL schemes", () => {
    expect(() => resolveDatabaseUrl("file:data/mm.db")).toThrow("Unsupported DATABASE_URL scheme");
    expect(() => resolveDatabaseUrl("tmp/mm.db")).toThrow("Unsupported DATABASE_URL scheme");
    expect(() => resolveDatabaseUrl("mysql://localhost/mm")).toThrow(
      "Unsupported DATABASE_URL scheme",
    );
  });
});
