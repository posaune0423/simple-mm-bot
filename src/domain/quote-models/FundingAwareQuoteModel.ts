import { err, type Result } from "neverthrow";

import {
  InvalidModelQuoteError,
  InvalidQuoteModelInputError,
  type QuoteModelError,
} from "../errors/DomainError.ts";
import { BasisPoints } from "../value-objects/BasisPoints.ts";
import { Price } from "../value-objects/Price.ts";
import { ModelQuote, type QuoteModel, type QuoteModelInput } from "./QuoteModel.ts";

export type FundingAwareQuoteModelParams = Readonly<{
  gamma: number;
  kappa: number;
  kInv: number;
  funding: Readonly<{
    spreadWideningBpsPerAbsFundingBps: number;
  }>;
}>;

export class FundingAwareQuoteModel implements QuoteModel {
  readonly name = "funding-aware";

  constructor(private readonly params: FundingAwareQuoteModelParams) {}

  compute(input: QuoteModelInput): Result<ModelQuote, QuoteModelError> {
    const invalidReason = this.validateInput(input);
    if (invalidReason !== undefined) {
      return err(new InvalidQuoteModelInputError(this.name, invalidReason));
    }

    const alphaDriftBps = signalOrZero(input.signals?.alphaDriftBps);
    const fundingRateBps = signalOrZero(input.signals?.fundingRateBps);
    const expectedFundingBps = signalOrZero(input.signals?.expectedFundingBps);
    const basisBps = signalOrZero(input.signals?.basisBps);
    const targetInventoryQty = signalOrZero(input.signals?.targetInventoryQty);
    const adjustedFairValue = input.fairPrice * Math.exp(alphaDriftBps / 10_000);
    const spread = this.computeSpread(input, adjustedFairValue, expectedFundingBps);
    const inventoryErrorQty = input.positionQty - targetInventoryQty;
    const inventorySkew = this.computeSkew(input, inventoryErrorQty);
    const fundingCarrySkew = adjustedFairValue * (expectedFundingBps / 10_000);
    const reservationPriceValue = adjustedFairValue - inventorySkew - fundingCarrySkew;
    const bidPrice = Math.max(0, reservationPriceValue - spread / 2);
    const askPrice = Math.max(0, reservationPriceValue + spread / 2);
    const halfSpreadBps =
      adjustedFairValue <= 0
        ? undefined
        : BasisPoints.unsafe((spread / 2 / adjustedFairValue) * 10_000);

    return ModelQuote.create({
      bidPrice: Price.unsafe(bidPrice),
      askPrice: Price.unsafe(askPrice),
      bidQuantity: input.quoteSize,
      askQuantity: input.quoteSize,
      fairPrice: Price.unsafe(adjustedFairValue),
      reservationPrice: Price.unsafe(reservationPriceValue),
      halfSpreadBps,
      diagnostics: {
        modelName: this.name,
        volatilitySigma: input.volatilitySigma,
        inventorySkew,
        gamma: this.params.gamma,
        kappa: this.params.kappa,
        alphaDriftBps,
        fundingRateBps,
        expectedFundingBps,
        basisBps,
        targetInventoryQty,
        inventoryErrorQty,
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
    if (
      !Number.isFinite(this.params.funding.spreadWideningBpsPerAbsFundingBps) ||
      this.params.funding.spreadWideningBpsPerAbsFundingBps < 0
    ) {
      return `spreadWideningBpsPerAbsFundingBps must be finite and non-negative: ${this.params.funding.spreadWideningBpsPerAbsFundingBps}`;
    }
    return validateSignals(input);
  }

  private computeSpread(
    input: QuoteModelInput,
    adjustedFairValue: number,
    expectedFundingBps: number,
  ): number {
    const { gamma, kappa } = this.params;
    const varianceTerm = input.volatilitySigma ** 2 * input.timeHorizonSec;
    const minSpread =
      input.minSpreadBps === undefined ? 0 : adjustedFairValue * (input.minSpreadBps / 10_000);
    const modelSpread =
      gamma === 0 ? 2 / kappa : gamma * varianceTerm + (2 / gamma) * Math.log(1 + gamma / kappa);
    const fundingWidening =
      adjustedFairValue *
      ((Math.abs(expectedFundingBps) * this.params.funding.spreadWideningBpsPerAbsFundingBps) /
        10_000);

    return Math.max(modelSpread, minSpread) + fundingWidening;
  }

  private computeSkew(input: QuoteModelInput, inventoryErrorQty: number): number {
    const normalizedInventory = Math.tanh(inventoryErrorQty / input.inventoryScale);
    return (
      normalizedInventory *
      this.params.kInv *
      input.volatilitySigma *
      Math.sqrt(input.timeHorizonSec)
    );
  }
}

function signalOrZero(value: number | null | undefined): number {
  return value ?? 0;
}

function validateSignals(input: QuoteModelInput): string | undefined {
  const signals: Record<string, number | null | undefined> = input.signals ?? {};
  for (const [key, value] of Object.entries(signals)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return `${key} must be finite: ${String(value)}`;
    }
  }
  return undefined;
}
