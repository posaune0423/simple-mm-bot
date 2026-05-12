import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { Price } from "./Price";
import type { Quantity } from "./Quantity";

export type QuoteSide = "bid" | "ask";
export type OrderSide = "buy" | "sell";
export type ExposureIntent = "increase_exposure" | "reduce_exposure";
export type QuoteLevelIndex = number;

export type QuoteLeg = Readonly<{
  side: QuoteSide;
  price: Price;
  size: Quantity;
  level: QuoteLevelIndex;
  exposureIntent: ExposureIntent;
  reasonTags: readonly string[];
}>;

export const QuoteLeg = {
  create(input: {
    side: QuoteSide;
    price: Price;
    size: Quantity;
    level: number;
    exposureIntent: ExposureIntent;
    reasonTags?: readonly string[];
  }): Result<QuoteLeg, DomainError> {
    if (!Number.isInteger(input.level) || input.level < 0) {
      return err({
        type: "invalid_quote",
        reason: `quote level must be a non-negative integer: ${input.level}`,
      });
    }
    return ok(QuoteLeg.unsafe(input));
  },

  unsafe(input: {
    side: QuoteSide;
    price: Price;
    size: Quantity;
    level: number;
    exposureIntent: ExposureIntent;
    reasonTags?: readonly string[];
  }): QuoteLeg {
    return Object.freeze({
      side: input.side,
      price: input.price,
      size: input.size,
      level: input.level,
      exposureIntent: input.exposureIntent,
      reasonTags: Object.freeze([...(input.reasonTags ?? [])]),
    });
  },
};
