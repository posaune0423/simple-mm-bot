import { err, ok, type Result } from "neverthrow";
import { InvalidQuoteError, type DomainError } from "../errors/DomainError";
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

export abstract class QuoteModelError extends Error {
  abstract readonly code: string;

  protected constructor(
    readonly model: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export class InvalidQuoteModelInputError extends QuoteModelError {
  readonly code = "quote_model.invalid_input";

  constructor(model: string, message: string, options: { cause?: unknown } = {}) {
    super(model, message, options);
  }
}

export class InvalidModelQuoteError extends QuoteModelError {
  readonly code = "quote_model.invalid_model_quote";

  constructor(model: string, message: string, options: { cause?: unknown } = {}) {
    super(model, message, options);
  }
}

export interface QuoteModel {
  readonly name: string;
  compute(input: QuoteModelInput): Result<ModelQuote, QuoteModelError>;
}
