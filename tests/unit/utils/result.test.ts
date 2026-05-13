import { describe, expect, test } from "bun:test";
import { err, ok } from "neverthrow";

import {
  combine,
  combineProperties,
  fromResult,
  sequence,
  tryCatch,
  tryCatchAsync,
} from "../../../src/utils/result.ts";

describe("result helpers", () => {
  test("combine and sequence collect ok values and short-circuit on first error", () => {
    expect(combine([ok(1), ok(2)])._unsafeUnwrap()).toEqual([1, 2]);
    expect(sequence([ok("a"), ok("b")])._unsafeUnwrap()).toEqual(["a", "b"]);

    const combined = combine([ok(1), err("first"), err("second")]);

    expect(combined.isErr()).toBe(true);
    expect(combined._unsafeUnwrapErr()).toBe("first");
  });

  test("combineProperties converts object properties from Result to plain values", () => {
    const result = combineProperties({
      price: ok(100),
      quantity: ok(0.1),
    });

    expect(result._unsafeUnwrap()).toEqual({
      price: 100,
      quantity: 0.1,
    });
    expect(
      combineProperties({
        price: ok(100),
        quantity: err("bad quantity"),
      })._unsafeUnwrapErr(),
    ).toBe("bad quantity");
  });

  test("tryCatch helpers preserve existing neverthrow behavior", async () => {
    expect(tryCatch(() => 1, String)._unsafeUnwrap()).toBe(1);
    expect(
      tryCatch(() => {
        throw new Error("boom");
      }, String)._unsafeUnwrapErr(),
    ).toBe("Error: boom");

    const asyncResult = await tryCatchAsync(Promise.resolve("ok"), String);
    expect(asyncResult._unsafeUnwrap()).toBe("ok");

    const lifted = await fromResult(ok("lifted"));
    expect(lifted._unsafeUnwrap()).toBe("lifted");
  });
});
