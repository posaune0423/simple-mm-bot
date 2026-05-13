import { describe, expect, test } from "bun:test";

import {
  DomainError,
  InvalidQuoteEngineInputError,
  InvalidQuoteModelInputError,
  InvalidPriceError,
  StrategyQuoteFailedError,
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

  test("keeps quote model, quote engine, and strategy errors under the domain base", () => {
    const cause = new InvalidQuoteModelInputError("avellaneda-stoikov", "bad sigma");
    const engineError = new InvalidQuoteEngineInputError("bad input", {
      context: { sigma: Number.NaN },
      cause,
    });
    const strategyError = new StrategyQuoteFailedError("simple_pmm", "quote failed", {
      cause: engineError,
    });

    expect(cause).toBeInstanceOf(DomainError);
    expect(engineError).toBeInstanceOf(DomainError);
    expect(strategyError).toBeInstanceOf(DomainError);
    expect(cause.context).toEqual({ model: "avellaneda-stoikov" });
    expect(strategyError.context).toEqual({ strategy: "simple_pmm" });
    expect(strategyError.cause).toBe(engineError);
  });
});
