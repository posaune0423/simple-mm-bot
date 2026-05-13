import { describe, expect, test } from "bun:test";

import {
  DomainError,
  InvalidPriceError,
  formatDomainError,
  isDomainError,
} from "../../../src/domain/errors/DomainError";

describe("DomainError", () => {
  test("uses Error subclasses with stable code and context", () => {
    const cause = new Error("raw validation failure");
    const error = new InvalidPriceError("bidPrice", 0, "price must be finite and positive", {
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(InvalidPriceError);
    expect(isDomainError(error)).toBe(true);
    expect(error.name).toBe("InvalidPriceError");
    expect(error.code).toBe("domain.invalid_price");
    expect(error.context).toEqual({
      field: "bidPrice",
      value: 0,
      reason: "price must be finite and positive",
    });
    expect(error.cause).toBe(cause);
    expect(formatDomainError(error)).toBe(
      "[domain.invalid_price] price must be finite and positive field=bidPrice value=0 reason=price must be finite and positive",
    );
  });

  test("rejects unknown objects as domain errors", () => {
    expect(isDomainError({ code: "domain.invalid_price" })).toBe(false);
    expect(isDomainError(new Error("invalid_price"))).toBe(false);
  });
});
