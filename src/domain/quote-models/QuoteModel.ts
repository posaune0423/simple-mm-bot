import { err, ok, type Result } from "neverthrow";
import { InvalidQuoteError, type DomainError, type QuoteModelError } from "../errors/DomainError";
import type { BasisPoints } from "../value-objects/BasisPoints";
import type { Price } from "../value-objects/Price";
import type { Quantity } from "../value-objects/Quantity";

export type QuoteModelInput = Readonly<{
  fairPrice: Price;
  volatilitySigma: number;
  quoteSize: Quantity;
  positionQty: number;
  inventoryScale: number;
  timeHorizonSec: number;
  minSpreadBps?: BasisPoints;
}>;

type ModelQuoteDiagnostics = Readonly<{
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
      return err(
        new InvalidQuoteError(
          `model quote must not be crossed: bid=${input.bidPrice}, ask=${input.askPrice}`,
          { context: { bid: input.bidPrice, ask: input.askPrice } },
        ),
      );
    }
    return ok(
      Object.freeze({
        ...input,
        diagnostics: Object.freeze({ ...input.diagnostics }),
      }),
    );
  },
};

export interface QuoteModel {
  readonly name: string;
  compute(input: QuoteModelInput): Result<ModelQuote, QuoteModelError>;
}
