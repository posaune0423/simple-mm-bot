import { describe, expect, test } from "bun:test";

import type { DomainError } from "../../../src/domain/errors/DomainError";
import { formatDomainError, isDomainError } from "../../../src/domain/errors/DomainError";

describe("DomainError", () => {
  test("uses serializable discriminated unions instead of Error subclasses", () => {
    const error: DomainError = {
      type: "invalid_price",
      field: "bidPrice",
      value: 0,
      reason: "price must be finite and positive",
    };

    expect(error).not.toBeInstanceOf(Error);
    expect(isDomainError(error)).toBe(true);
    expect(formatDomainError(error)).toBe(
      "[invalid_price] bidPrice=0: price must be finite and positive",
    );
  });

  test("rejects unknown objects as domain errors", () => {
    expect(isDomainError({ type: "invalid_price" })).toBe(false);
    expect(isDomainError(new Error("invalid_price"))).toBe(false);
  });
});
