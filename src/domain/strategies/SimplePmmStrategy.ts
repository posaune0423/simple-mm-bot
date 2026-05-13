import type { Result } from "neverthrow";
import type {
  QuoteEngine,
  QuoteEngineError,
  QuoteEngineInput,
  QuoteSideSpecs,
} from "../services/QuoteEngine";
import {
  StrategyDecision,
  StrategyQuoteFailedError,
  type SideMarkoutFeedback,
  type Strategy,
  type StrategyError,
  type StrategyInput,
} from "./Strategy";

export type MarkoutFeedbackGateConfig = Readonly<{
  enabled: boolean;
  minAverageMarkoutBps: number;
  minSamples: number;
  lookbackFills?: number;
  maxFillAgeMs?: number;
  horizonsSec: readonly number[];
}>;

export interface SimplePmmStrategyConfig {
  markoutFeedbackGate?: MarkoutFeedbackGateConfig;
}

export class SimplePmmStrategy implements Strategy {
  readonly name = "simple_pmm";

  constructor(
    private readonly quoteEngine: QuoteEngine,
    private readonly config: SimplePmmStrategyConfig = {},
  ) {}

  decide(input: StrategyInput): Result<StrategyDecision, StrategyError> {
    const quoteInput: QuoteEngineInput = {
      snapshot: input.snapshot,
      position: input.position,
      sideSpecs: this.buildSideSpecs(input.markoutFeedback),
    };

    return this.quoteEngine
      .compute(quoteInput)
      .mapErr((error) => this.quoteEngineError(error))
      .map((quote) =>
        StrategyDecision.quote({
          quote,
          reasonTags: quote.diagnostics.reasonTags,
          diagnostics: {
            strategy: this.name,
            quoteModel: quote.diagnostics.quoteModel,
          },
        }),
      );
  }

  private buildSideSpecs(quality: readonly SideMarkoutFeedback[]): QuoteSideSpecs {
    const bid = defaultSideSpec();
    const ask = defaultSideSpec();
    const gate = this.config.markoutFeedbackGate;
    if (gate === undefined || !gate.enabled) {
      return { bid, ask };
    }

    for (const sideQuality of quality) {
      const reasonTags = this.qualityFailureReasons(sideQuality, gate);
      if (reasonTags.length === 0) {
        continue;
      }
      if (sideQuality.side === "buy") {
        bid.disableIncreaseExposure = true;
        bid.reasonTags = [...reasonTags];
      } else {
        ask.disableIncreaseExposure = true;
        ask.reasonTags = [...reasonTags];
      }
    }
    return { bid, ask };
  }

  private qualityFailureReasons(
    sideQuality: SideMarkoutFeedback,
    gate: MarkoutFeedbackGateConfig,
  ): readonly string[] {
    return gate.horizonsSec.flatMap((horizonSec) => {
      const horizon = sideQuality.horizons.find((entry) => entry.horizonSec === horizonSec);
      if (
        horizon === undefined ||
        horizon.averageMarkoutBps === null ||
        horizon.sampleCount < gate.minSamples ||
        horizon.averageMarkoutBps >= gate.minAverageMarkoutBps
      ) {
        return [];
      }
      return [
        `quality_gate:${sideQuality.side}:${horizonSec}s_markout_below_${gate.minAverageMarkoutBps}bps`,
      ];
    });
  }

  private quoteEngineError(error: QuoteEngineError): StrategyError {
    return new StrategyQuoteFailedError(this.name, error.message, { cause: error });
  }
}

function defaultSideSpec() {
  return {
    enabled: true,
    distanceMultiplier: 1,
    sizeMultiplier: 1,
    disableIncreaseExposure: false,
    reasonTags: [] as string[],
  };
}
