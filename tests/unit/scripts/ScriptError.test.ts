import { describe, expect, test } from "bun:test";

import {
  formatScriptError,
  isScriptError,
  ScriptError,
} from "../../../scripts/errors/ScriptError.ts";

describe("ScriptError", () => {
  test("script/tooling failures have an explicit non-utils error boundary", () => {
    const cause = new Error("sqlite open failed");
    const error = new ScriptError(
      "script.report.db_open_failed",
      "Failed to open SQLite database",
      {
        context: { databaseUrl: "file:data/mm.db" },
        cause,
      },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("script.report.db_open_failed");
    expect(error.context).toEqual({ databaseUrl: "file:data/mm.db" });
    expect(error.cause).toBe(cause);
    expect(isScriptError(error)).toBe(true);
    expect(formatScriptError(error)).toBe(
      "[script.report.db_open_failed] Failed to open SQLite database databaseUrl=file:data/mm.db",
    );
  });
});
