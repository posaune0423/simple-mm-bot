import { describe, expect, test } from "bun:test";

import { InvalidQuoteError } from "../../../src/domain/errors/DomainError.ts";
import {
  describeError,
  formatUnknownError,
  getErrorName,
  stringifyError,
} from "../../../src/utils/errors.ts";

describe("errors", () => {
  test("formats unknown errors for log callers without branching", () => {
    const namedError = new Error("HTTP error 408");
    namedError.name = "BulkHttpError";
    const domainError = new InvalidQuoteError("crossed quote", {
      context: { bid: 101, ask: 100 },
    });

    expect(formatUnknownError(domainError)).toBe("[domain.invalid_quote] crossed quote");
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
    const error = new ConfigLoadError("config.invalid", "Config validation failed", {
      context: { configPath: "config/test.yml" },
      cause,
    });

    expect(describeError(error)).toEqual({
      code: "config.invalid",
      title: "config.invalid",
      reason: "Config validation failed",
      cause: "bad yaml",
      chain: ["ConfigLoadError: Config validation failed", "bad yaml"],
      context: {
        configPath: "config/test.yml",
      },
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

class ConfigLoadError extends Error {
  readonly context: Record<string, unknown>;

  constructor(
    readonly code: string,
    message: string,
    options: { context: Record<string, unknown>; cause: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "ConfigLoadError";
    this.context = options.context;
  }
}
