import { describe, expect, test } from "bun:test";

import {
  formatScriptError,
  isScriptError,
  ScriptError,
} from "../../../scripts/errors/ScriptError.ts";

describe("ScriptError", () => {
  test("script/tooling failures have an explicit non-utils error boundary", () => {
    const cause = new Error("database connection failed");
    const error = new ScriptError(
      "script.metrics.report_failed",
      "Failed to generate metrics report",
      {
        context: { reportPath: "data/metrics/latest.md" },
        cause,
      },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("script.metrics.report_failed");
    expect(error.context).toEqual({ reportPath: "data/metrics/latest.md" });
    expect(error.cause).toBe(cause);
    expect(isScriptError(error)).toBe(true);
    expect(formatScriptError(error)).toBe(
      "[script.metrics.report_failed] Failed to generate metrics report reportPath=data/metrics/latest.md",
    );
  });
});
