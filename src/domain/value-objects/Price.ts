import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { Brand } from "./Brand";

export type Price = Brand<number, "Price">;

export const Price = {
  create(value: number, field = "price"): Result<Price, DomainError> {
    if (!Number.isFinite(value) || value <= 0) {
      return err({
        type: "invalid_price",
        field,
        value,
        reason: "price must be finite and positive",
      });
    }
    return ok(value as Price);
  },

  unsafe(value: number): Price {
    return value as Price;
  },
};
