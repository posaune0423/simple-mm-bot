import { err, ok, type Result } from "neverthrow";

import type { AlphaDriftProvider } from "../ports/IAlphaDriftProvider.ts";
import type { QuoteModelSignals } from "../quote-models/QuoteModel.ts";
import type { QuoteEngine, QuoteEngineInput } from "../services/QuoteEngine.ts";
import { emptyQuoteNoQuoteDecision } from "./emptyQuoteDecision.ts";
import { buildQualityGatedSideSpecs, type MarkoutFeedbackGateConfig } from "./SimplePmmStrategy.ts";
import { StrategyDecision, type Strategy, type StrategyInput } from "./Strategy.ts";
import {
  StrategyQuoteFailedError,
  type QuoteEngineError,
  type StrategyError,
} from "../errors/DomainError.ts";

export type FundingAwarePmmStrategyConfig = Readonly<{
  alpha: Readonly<{
    enabled: boolean;
    source: "none" | "allora";
  }>;
  targetInventory: Readonly<{
    maxQty: number;
    alphaQtyPerBps: number;
  }>;
  funding: Readonly<{
    rateHorizonSec: number;
    holdingHorizonSec: number;
  }>;
  markoutFeedbackGate?: MarkoutFeedbackGateConfig;
}>;

type QuoteEngineDependency = Pick<QuoteEngine, "compute">;

export class FundingAwarePmmStrategy implements Strategy {
  readonly name = "funding_aware_pmm";

  constructor(
    private readonly quoteEngine: QuoteEngineDependency,
    private readonly config: FundingAwarePmmStrategyConfig,
    private readonly alphaProvider?: AlphaDriftProvider,
  ) {}

  decide(input: StrategyInput): Result<StrategyDecision, StrategyError> {
    const quoteInput: QuoteEngineInput = {
      snapshot: input.snapshot,
      position: input.position,
      sideSpecs: buildQualityGatedSideSpecs(input.markoutFeedback, this.config.markoutFeedbackGate),
      modelSignals: this.buildModelSignals(input),
    };

    const quoteResult = this.quoteEngine.compute(quoteInput);
    if (quoteResult.isErr()) {
      const noQuote = emptyQuoteNoQuoteDecision(this.name, quoteResult.error);
      if (noQuote !== null) {
        return ok(noQuote);
      }
      return err(this.quoteEngineError(quoteResult.error));
    }

    return ok(
      StrategyDecision.quote({
        quote: quoteResult.value,
        reasonTags: quoteResult.value.diagnostics.reasonTags,
        diagnostics: {
          strategy: this.name,
          quoteModel: quoteResult.value.diagnostics.quoteModel,
        },
      }),
    );
  }

  private buildModelSignals(input: StrategyInput): QuoteModelSignals {
    const alphaDriftBps = this.alphaDrift(input.nowMs);
    const fundingRateBps = finiteOrZero(input.snapshot.fundingRateBps);
    const expectedFunding = computeExpectedFundingBps(
      fundingRateBps,
      this.config.funding.rateHorizonSec,
      this.config.funding.holdingHorizonSec,
    );
    const basisBps = basisBpsFromSnapshot(input.snapshot.indexPrice, input.snapshot.oraclePrice);
    return {
      alphaDriftBps,
      fundingRateBps,
      expectedFundingBps: expectedFunding,
      basisBps,
      targetInventoryQty: this.targetInventoryQty(alphaDriftBps),
    };
  }

  private alphaDrift(nowMs: number): number {
    if (!this.config.alpha.enabled || this.config.alpha.source === "none") {
      return 0;
    }
    return this.alphaProvider?.current(nowMs).alphaDriftBps ?? 0;
  }

  private targetInventoryQty(alphaDriftBps: number): number {
    const target = alphaDriftBps * this.config.targetInventory.alphaQtyPerBps;
    return clamp(target, -this.config.targetInventory.maxQty, this.config.targetInventory.maxQty);
  }

  private quoteEngineError(error: QuoteEngineError): StrategyError {
    return new StrategyQuoteFailedError(this.name, error.message, { cause: error });
  }
}

function finiteOrZero(value: number | null | undefined): number {
  return value === null || value === undefined || !Number.isFinite(value) ? 0 : value;
}

function computeExpectedFundingBps(
  fundingRateBps: number | null | undefined,
  rateHorizonSec: number,
  holdingHorizonSec: number,
): number {
  if (
    fundingRateBps === null ||
    fundingRateBps === undefined ||
    !Number.isFinite(fundingRateBps) ||
    rateHorizonSec <= 0
  ) {
    return 0;
  }
  return fundingRateBps * (holdingHorizonSec / rateHorizonSec);
}

function basisBpsFromSnapshot(
  indexPrice: number | null | undefined,
  oraclePrice: number | null | undefined,
): number {
  if (
    indexPrice === null ||
    indexPrice === undefined ||
    oraclePrice === null ||
    oraclePrice === undefined ||
    !Number.isFinite(indexPrice) ||
    !Number.isFinite(oraclePrice) ||
    indexPrice <= 0
  ) {
    return 0;
  }
  return ((oraclePrice - indexPrice) / indexPrice) * 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
