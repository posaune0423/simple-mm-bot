import { err, ok, type Result } from "neverthrow";
import { InvalidBasisPointsError, type DomainError } from "../errors/DomainError";

declare const basisPointsBrand: unique symbol;

export type BasisPoints = number & { readonly [basisPointsBrand]: "BasisPoints" };

export const BasisPoints = {
  create(value: number, field = "basisPoints"): Result<BasisPoints, DomainError> {
    if (!Number.isFinite(value)) {
      return err(new InvalidBasisPointsError(field, value, "basis points must be finite"));
    }
    return ok(value as BasisPoints);
  },

  createNonNegative(value: number, field = "basisPoints"): Result<BasisPoints, DomainError> {
    if (!Number.isFinite(value) || value < 0) {
      return err(
        new InvalidBasisPointsError(field, value, "basis points must be finite and non-negative"),
      );
    }
    return ok(value as BasisPoints);
  },

  unsafe(value: number): BasisPoints {
    return value as BasisPoints;
  },
};
