import { err, ok, type Result } from "neverthrow";
import { InvalidQuantityError, type DomainError } from "../errors/DomainError";

declare const quantityBrand: unique symbol;

export type Quantity = number & { readonly [quantityBrand]: "Quantity" };

export const Quantity = {
  create(value: number, field = "quantity"): Result<Quantity, DomainError> {
    if (!Number.isFinite(value) || value <= 0) {
      return err(new InvalidQuantityError(field, value, "quantity must be finite and positive"));
    }
    return ok(value as Quantity);
  },

  unsafe(value: number): Quantity {
    return value as Quantity;
  },
};
