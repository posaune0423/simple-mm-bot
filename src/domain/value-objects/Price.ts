import { err, ok, type Result } from "neverthrow";
import { InvalidPriceError, type DomainError } from "../errors/DomainError";

declare const priceBrand: unique symbol;

export type Price = number & { readonly [priceBrand]: "Price" };

export const Price = {
  create(value: number, field = "price"): Result<Price, DomainError> {
    if (!Number.isFinite(value) || value <= 0) {
      return err(new InvalidPriceError(field, value, "price must be finite and positive"));
    }
    return ok(value as Price);
  },

  unsafe(value: number): Price {
    return value as Price;
  },
};
