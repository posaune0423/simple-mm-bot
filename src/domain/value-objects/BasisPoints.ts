import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { Brand } from "./Brand";

export type BasisPoints = Brand<number, "BasisPoints">;

export const BasisPoints = {
  create(value: number, field = "basisPoints"): Result<BasisPoints, DomainError> {
    if (!Number.isFinite(value)) {
      return err({
        type: "invalid_basis_points",
        field,
        value,
        reason: "basis points must be finite",
      });
    }
    return ok(value as BasisPoints);
  },

  createNonNegative(value: number, field = "basisPoints"): Result<BasisPoints, DomainError> {
    if (!Number.isFinite(value) || value < 0) {
      return err({
        type: "invalid_basis_points",
        field,
        value,
        reason: "basis points must be finite and non-negative",
      });
    }
    return ok(value as BasisPoints);
  },

  unsafe(value: number): BasisPoints {
    return value as BasisPoints;
  },
};
