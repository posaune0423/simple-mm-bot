import { err, ok, type Result } from "neverthrow";
import {
  StrategyQuoteFailedError,
  type QuoteEngineError,
  type StrategyError,
} from "../errors/DomainError";
import type { QuoteEngine, QuoteEngineInput, QuoteSideSpecs } from "../services/QuoteEngine";
import {
  StrategyDecision,
  type SideMarkoutFeedback,
  type Strategy,
  type StrategyInput,
} from "./Strategy";
import { emptyQuoteNoQuoteDecision } from "./emptyQuoteDecision";

export type MarkoutFeedbackGateConfig = Readonly<{
  enabled: boolean;
  action?: "disable" | "tag" | "rebalance";
  minAverageMarkoutBps: number;
  maxAdverseSelectionRate?: number;
  minSamples: number;
  lookbackFills?: number;
  maxFillAgeMs?: number;
  horizonsSec: readonly number[];
  toxicDistanceMultiplier?: number;
  toxicSizeMultiplier?: number;
  disableToxicIncreaseExposure?: boolean;
  compensatingDistanceMultiplier?: number;
  compensatingSizeMultiplier?: number;
}>;

interface SimplePmmStrategyConfig {
  markoutFeedbackGate?: MarkoutFeedbackGateConfig;
}

type QuoteEngineDependency = Pick<QuoteEngine, "compute">;

type QualityFailure = Readonly<{
  side: SideMarkoutFeedback["side"];
  reasonTags: readonly string[];
  severity: number;
}>;

export class SimplePmmStrategy implements Strategy {
  readonly name = "simple_pmm";

  constructor(
    private readonly quoteEngine: QuoteEngineDependency,
    private readonly config: SimplePmmStrategyConfig = {},
  ) {}

  decide(input: StrategyInput): Result<StrategyDecision, StrategyError> {
    const quoteInput: QuoteEngineInput = {
      snapshot: input.snapshot,
      position: input.position,
      sideSpecs: this.buildSideSpecs(input.markoutFeedback),
      nowMs: input.nowMs,
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

  private buildSideSpecs(quality: readonly SideMarkoutFeedback[]): QuoteSideSpecs {
    return buildQualityGatedSideSpecs(quality, this.config.markoutFeedbackGate);
  }

  private quoteEngineError(error: QuoteEngineError): StrategyError {
    return new StrategyQuoteFailedError(this.name, error.message, { cause: error });
  }
}

export function buildQualityGatedSideSpecs(
  quality: readonly SideMarkoutFeedback[],
  gate: MarkoutFeedbackGateConfig | undefined,
): QuoteSideSpecs {
  const bid = defaultSideSpec();
  const ask = defaultSideSpec();
  if (gate === undefined || !gate.enabled) {
    return { bid, ask };
  }

  const failures = quality.flatMap((sideQuality) => {
    const failure = assessQualityFailure(sideQuality, gate);
    return failure === null ? [] : [failure];
  });
  if (gate.action === "rebalance") {
    const allFailedSides = new Set(failures.map((failure) => failure.side));
    const rebalancedSides = new Set<SideMarkoutFeedback["side"]>();
    for (const failure of selectRebalanceFailures(failures)) {
      rebalancedSides.add(failure.side);
      if (failure.side === "buy") {
        applyFailureSpec(bid, gate, failure.reasonTags);
      } else {
        applyFailureSpec(ask, gate, failure.reasonTags);
      }
    }
    applyCompensationSpecs({ bid, ask }, gate, quality, rebalancedSides, allFailedSides);
    return { bid, ask };
  }

  const failedSides = new Set<SideMarkoutFeedback["side"]>();
  for (const failure of failures) {
    failedSides.add(failure.side);
    if (failure.side === "buy") {
      applyFailureSpec(bid, gate, failure.reasonTags);
    } else {
      applyFailureSpec(ask, gate, failure.reasonTags);
    }
  }
  applyCompensationSpecs({ bid, ask }, gate, quality, failedSides, failedSides);
  return { bid, ask };
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

function applyFailureSpec(
  spec: ReturnType<typeof defaultSideSpec>,
  gate: MarkoutFeedbackGateConfig,
  reasonTags: readonly string[],
) {
  spec.reasonTags = [...reasonTags];
  if (gate.action === "tag") {
    return;
  }
  if (gate.action === "rebalance") {
    spec.distanceMultiplier *= gate.toxicDistanceMultiplier ?? 1.15;
    spec.sizeMultiplier *= gate.toxicSizeMultiplier ?? 0.8;
    spec.disableIncreaseExposure = gate.disableToxicIncreaseExposure ?? false;
    return;
  }
  spec.disableIncreaseExposure = true;
}

function applyCompensationSpecs(
  specs: { bid: ReturnType<typeof defaultSideSpec>; ask: ReturnType<typeof defaultSideSpec> },
  gate: MarkoutFeedbackGateConfig,
  quality: readonly SideMarkoutFeedback[],
  rebalancedSides: ReadonlySet<SideMarkoutFeedback["side"]>,
  allFailedSides: ReadonlySet<SideMarkoutFeedback["side"]>,
) {
  if (gate.action !== "rebalance" || rebalancedSides.size !== 1) {
    return;
  }
  const toxicSide = [...rebalancedSides][0];
  if (toxicSide === "buy") {
    compensate(
      specs.ask,
      "sell",
      toxicSide,
      gate,
      shouldUseConservativeCompensation(quality, gate, "sell", allFailedSides),
    );
  } else if (toxicSide === "sell") {
    compensate(
      specs.bid,
      "buy",
      toxicSide,
      gate,
      shouldUseConservativeCompensation(quality, gate, "buy", allFailedSides),
    );
  }
}

function shouldUseConservativeCompensation(
  quality: readonly SideMarkoutFeedback[],
  gate: MarkoutFeedbackGateConfig,
  targetSide: SideMarkoutFeedback["side"],
  allFailedSides: ReadonlySet<SideMarkoutFeedback["side"]>,
): boolean {
  if (allFailedSides.has(targetSide)) {
    return true;
  }
  const targetQuality = quality.find((entry) => entry.side === targetSide);
  if (targetQuality === undefined) {
    return true;
  }
  return !targetQuality.horizons.some((horizon) => isHealthyHorizon(horizon, gate));
}

function isHealthyHorizon(
  horizon: SideMarkoutFeedback["horizons"][number],
  gate: MarkoutFeedbackGateConfig,
): boolean {
  if (!gate.horizonsSec.includes(horizon.horizonSec) || horizon.sampleCount < gate.minSamples) {
    return false;
  }
  const markoutBps = horizon.weightedAverageMarkoutBps ?? horizon.averageMarkoutBps;
  if (markoutBps === null || markoutBps < gate.minAverageMarkoutBps) {
    return false;
  }
  if (gate.maxAdverseSelectionRate === undefined) {
    return true;
  }
  return (
    horizon.adverseSelectionRate !== undefined &&
    horizon.adverseSelectionRate !== null &&
    horizon.adverseSelectionRate <= gate.maxAdverseSelectionRate
  );
}

function compensate(
  spec: ReturnType<typeof defaultSideSpec>,
  side: SideMarkoutFeedback["side"],
  toxicSide: SideMarkoutFeedback["side"],
  gate: MarkoutFeedbackGateConfig,
  targetAlsoFailed: boolean,
) {
  const distanceMultiplier = gate.compensatingDistanceMultiplier ?? 0.92;
  const sizeMultiplier = gate.compensatingSizeMultiplier ?? 1.2;
  if (targetAlsoFailed) {
    spec.distanceMultiplier *= (1 + distanceMultiplier) / 2;
    spec.sizeMultiplier *= Math.min(sizeMultiplier, 1);
    spec.reasonTags = [
      ...spec.reasonTags,
      `quality_gate:${side}:conservative_rebalance_against_${toxicSide}`,
    ];
    return;
  }
  spec.distanceMultiplier *= distanceMultiplier;
  spec.sizeMultiplier *= sizeMultiplier;
  spec.reasonTags = [...spec.reasonTags, `quality_gate:${side}:rebalance_against_${toxicSide}`];
}

function selectRebalanceFailures(failures: readonly QualityFailure[]): readonly QualityFailure[] {
  if (failures.length <= 1) {
    return failures;
  }
  const [firstFailure, ...remainingFailures] = failures;
  if (firstFailure === undefined) {
    return [];
  }
  const worstFailure = remainingFailures.reduce((worst, failure) => {
    return failure.severity > worst.severity ? failure : worst;
  }, firstFailure);
  return [worstFailure];
}

function assessQualityFailure(
  sideQuality: SideMarkoutFeedback,
  gate: MarkoutFeedbackGateConfig,
): QualityFailure | null {
  const failure = gate.horizonsSec.reduce(
    (acc, horizonSec) => {
      const horizon = sideQuality.horizons.find((entry) => entry.horizonSec === horizonSec);
      if (horizon === undefined || horizon.sampleCount < gate.minSamples) {
        return acc;
      }
      const markoutBps = horizon.weightedAverageMarkoutBps ?? horizon.averageMarkoutBps;
      if (markoutBps !== null && markoutBps < gate.minAverageMarkoutBps) {
        const metric = horizon.weightedAverageMarkoutBps === undefined ? "markout" : "vw_markout";
        acc.reasonTags.push(
          `quality_gate:${sideQuality.side}:${horizonSec}s_${metric}_below_${gate.minAverageMarkoutBps}bps`,
        );
        acc.severity += gate.minAverageMarkoutBps - markoutBps;
      }
      if (
        gate.maxAdverseSelectionRate !== undefined &&
        horizon.adverseSelectionRate !== undefined &&
        horizon.adverseSelectionRate !== null &&
        horizon.adverseSelectionRate > gate.maxAdverseSelectionRate
      ) {
        acc.reasonTags.push(
          `quality_gate:${sideQuality.side}:${horizonSec}s_adverse_selection_above_${Math.round(
            gate.maxAdverseSelectionRate * 100,
          )}%`,
        );
        acc.severity += (horizon.adverseSelectionRate - gate.maxAdverseSelectionRate) * 10;
      }
      return acc;
    },
    { reasonTags: [] as string[], severity: 0 },
  );
  if (failure.reasonTags.length === 0) {
    return null;
  }
  return {
    side: sideQuality.side,
    reasonTags: failure.reasonTags,
    severity: failure.severity,
  };
}
