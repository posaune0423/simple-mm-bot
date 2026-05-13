import { err, type Result } from "neverthrow";
import type { AvellanedaStoikovParams } from "./AvellanedaStoikovParams";
import { BasisPoints } from "../value-objects/BasisPoints";
import { Price } from "../value-objects/Price";
import {
  InvalidModelQuoteError,
  InvalidQuoteModelInputError,
  ModelQuote,
  type QuoteModel,
  type QuoteModelError,
  type QuoteModelInput,
} from "./QuoteModel";

export class AvellanedaStoikovQuoteModel implements QuoteModel {
  readonly name = "avellaneda-stoikov";

  constructor(private readonly params: AvellanedaStoikovParams) {}

  compute(input: QuoteModelInput): Result<ModelQuote, QuoteModelError> {
    const invalidReason = this.validateInput(input);
    if (invalidReason !== undefined) {
      return err(new InvalidQuoteModelInputError(this.name, invalidReason));
    }

    const spread = this.computeSpread(input);
    const inventorySkew = this.computeSkew(input);
    const reservationPriceValue = input.fairPrice - inventorySkew;
    const bidPrice = Math.max(0, reservationPriceValue - spread / 2);
    const askPrice = Math.max(0, reservationPriceValue + spread / 2);
    const halfSpreadBps =
      input.fairPrice <= 0
        ? undefined
        : BasisPoints.unsafe((spread / 2 / input.fairPrice) * 10_000);

    return ModelQuote.create({
      bidPrice: Price.unsafe(bidPrice),
      askPrice: Price.unsafe(askPrice),
      bidQuantity: input.quoteSize,
      askQuantity: input.quoteSize,
      fairPrice: input.fairPrice,
      reservationPrice: Price.unsafe(reservationPriceValue),
      halfSpreadBps,
      diagnostics: {
        modelName: this.name,
        volatilitySigma: input.volatilitySigma,
        inventorySkew,
        gamma: this.params.gamma,
        kappa: this.params.kappa,
      },
    }).mapErr((error) => new InvalidModelQuoteError(this.name, error.message, { cause: error }));
  }

  private validateInput(input: QuoteModelInput): string | undefined {
    if (!Number.isFinite(input.volatilitySigma) || input.volatilitySigma < 0) {
      return `volatilitySigma must be finite and non-negative: ${input.volatilitySigma}`;
    }
    if (!Number.isFinite(input.positionQty)) {
      return `positionQty must be finite: ${input.positionQty}`;
    }
    if (!Number.isFinite(input.inventoryScale) || input.inventoryScale <= 0) {
      return `inventoryScale must be finite and positive: ${input.inventoryScale}`;
    }
    if (!Number.isFinite(input.timeHorizonSec) || input.timeHorizonSec < 0) {
      return `timeHorizonSec must be finite and non-negative: ${input.timeHorizonSec}`;
    }
    if (!Number.isFinite(this.params.kappa) || this.params.kappa <= 0) {
      return `kappa must be finite and positive: ${this.params.kappa}`;
    }
    if (!Number.isFinite(this.params.gamma) || this.params.gamma < 0) {
      return `gamma must be finite and non-negative: ${this.params.gamma}`;
    }
    if (!Number.isFinite(this.params.kInv)) {
      return `kInv must be finite: ${this.params.kInv}`;
    }
    return undefined;
  }

  private computeSpread(input: QuoteModelInput): number {
    const { gamma, kappa } = this.params;
    const varianceTerm = input.volatilitySigma ** 2 * input.timeHorizonSec;
    const minSpread =
      input.minSpreadBps === undefined ? 0 : input.fairPrice * (input.minSpreadBps / 10_000);

    if (gamma === 0) {
      return Math.max(2 / kappa, minSpread);
    }

    return Math.max(gamma * varianceTerm + (2 / gamma) * Math.log(1 + gamma / kappa), minSpread);
  }

  private computeSkew(input: QuoteModelInput): number {
    const normalizedInventory = Math.tanh(input.positionQty / input.inventoryScale);
    return (
      normalizedInventory *
      this.params.kInv *
      input.volatilitySigma *
      Math.sqrt(input.timeHorizonSec)
    );
  }
}
