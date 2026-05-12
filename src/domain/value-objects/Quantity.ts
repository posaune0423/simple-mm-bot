import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { Brand } from "./Brand";

export type Quantity = Brand<number, "Quantity">;

export const Quantity = {
  create(value: number, field = "quantity"): Result<Quantity, DomainError> {
    if (!Number.isFinite(value) || value <= 0) {
      return err({
        type: "invalid_quantity",
        field,
        value,
        reason: "quantity must be finite and positive",
      });
    }
    return ok(value as Quantity);
  },

  unsafe(value: number): Quantity {
    return value as Quantity;
  },
};
