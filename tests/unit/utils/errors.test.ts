import { describe, expect, test } from "bun:test";

import {
  createAppError,
  describeError,
  formatAppError,
  formatUnknownError,
  getErrorName,
  isAppError,
  stringifyError,
} from "../../../src/utils/errors.ts";

describe("errors", () => {
  test("identifies app errors by their public shape", () => {
    expect(isAppError(createAppError("config.invalid", "Config validation failed"))).toBe(true);
    expect(isAppError({ code: "runtime.failed", message: "Runtime failed" })).toBe(true);
    expect(isAppError({ code: "runtime.failed" })).toBe(false);
    expect(isAppError(new Error("Runtime failed"))).toBe(false);
    const systemError = new Error("No such file") as Error & { code: string };
    systemError.code = "ENOENT";
    expect(isAppError(systemError)).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  test("formats app errors with cause details", () => {
    const error = createAppError("config.invalid", "Config validation failed", "bad yaml");

    expect(formatAppError(error)).toBe("[config.invalid] Config validation failed: bad yaml");
  });

  test("formats unknown errors for log callers without branching", () => {
    const namedError = new Error("HTTP error 408");
    namedError.name = "BulkHttpError";

    expect(formatUnknownError(createAppError("config.invalid", "Config validation failed"))).toBe(
      "[config.invalid] Config validation failed",
    );
    expect(formatUnknownError(new Error("Runtime failed"))).toBe("Runtime failed");
    expect(formatUnknownError(namedError)).toBe("BulkHttpError: HTTP error 408");
    expect(formatUnknownError("plain failure")).toBe("plain failure");
    expect(formatUnknownError({ reason: "bad input" })).toBe('{"reason":"bad input"}');
  });

  test("stringifies non-json values with a string fallback", () => {
    expect(stringifyError(undefined)).toBe("undefined");
    expect(stringifyError(Symbol("bad"))).toBe("Symbol(bad)");
  });

  test("describes unknown errors for notification callers", () => {
    const cause = new Error("bad yaml");
    cause.stack = "Error: bad yaml\n    at loadConfig";

    expect(
      describeError(createAppError("config.invalid", "Config validation failed", cause)),
    ).toEqual({
      code: "config.invalid",
      title: "config.invalid",
      reason: "Config validation failed",
      cause: "bad yaml",
      details: "[config.invalid] Config validation failed: bad yaml",
      stack: cause.stack,
    });
    expect(describeError("plain failure")).toEqual({
      title: "Error",
      reason: "plain failure",
      details: "plain failure",
    });
  });

  test("extracts an error name only when present", () => {
    expect(getErrorName(new TypeError("bad type"))).toBe("TypeError");
    expect(getErrorName("bad type")).toBeUndefined();
  });
});
