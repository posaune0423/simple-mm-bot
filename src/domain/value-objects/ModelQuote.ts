import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { BasisPoints } from "./BasisPoints";
import type { Price } from "./Price";
import type { Quantity } from "./Quantity";

export type ModelQuoteDiagnostics = Readonly<{
  modelName: string;
  volatilitySigma: number;
  inventorySkew?: number;
  gamma?: number;
  kappa?: number;
}>;

export type ModelQuote = Readonly<{
  bidPrice: Price;
  askPrice: Price;
  bidQuantity: Quantity;
  askQuantity: Quantity;
  fairPrice: Price;
  reservationPrice?: Price;
  halfSpreadBps?: BasisPoints;
  diagnostics: ModelQuoteDiagnostics;
}>;

export const ModelQuote = {
  create(input: ModelQuote): Result<ModelQuote, DomainError> {
    if (input.bidPrice >= input.askPrice) {
      return err({
        type: "invalid_quote",
        reason: `model quote must not be crossed: bid=${input.bidPrice}, ask=${input.askPrice}`,
      });
    }
    return ok(
      Object.freeze({
        ...input,
        diagnostics: Object.freeze({ ...input.diagnostics }),
      }),
    );
  },
};
