import type { QuoteSideQuality, QuoteQualityHorizon } from "./QuoteQuality.ts";
import type { OrderSide } from "./entities/Quote.ts";
import { isFlatPositionQty } from "./entities/Position.ts";
import type { QuoteControls, QuoteSideControls } from "./QuoteControls.ts";

export interface QuoteQualityGateConfig {
  enabled: boolean;
  minAverageMarkoutBps: number;
  minSamples: number;
  lookbackFills?: number;
  horizonsSec: number[];
}

interface QuoteControlContext {
  positionQty?: number;
}

export class QuoteControlPolicy {
  constructor(private readonly config: QuoteQualityGateConfig) {}

  controlsFor(
    quality: ReadonlyArray<QuoteSideQuality>,
    context: QuoteControlContext = {},
  ): QuoteControls {
    if (!this.config.enabled) {
      return {};
    }

    const decisions: SideControlDecision[] = [];
    for (const sideQuality of quality) {
      const decision = this.sideControl(sideQuality.side, sideQuality.horizons);
      if (decision === undefined) {
        continue;
      }
      decisions.push(decision);
    }

    const activeDecisions = avoidFullQuoteBlackout(decisions, hasInventory(context.positionQty));
    const controls: QuoteControls = {};
    for (const decision of activeDecisions) {
      if (decision.side === "buy") {
        controls.bid = decision.control;
      } else {
        controls.ask = decision.control;
      }
    }
    return controls;
  }

  private sideControl(
    side: OrderSide,
    horizons: ReadonlyArray<QuoteQualityHorizon>,
  ): SideControlDecision | undefined {
    const failures = this.config.horizonsSec.flatMap((horizonSec) => {
      const horizon = horizons.find((entry) => entry.horizonSec === horizonSec);
      if (
        horizon === undefined ||
        horizon.averageMarkoutBps === null ||
        horizon.sampleCount < this.config.minSamples ||
        horizon.averageMarkoutBps >= this.config.minAverageMarkoutBps
      ) {
        return [];
      }

      return [
        {
          reason: `${horizonSec}s_markout_below_${formatThreshold(this.config.minAverageMarkoutBps)}bps`,
          averageMarkoutBps: horizon.averageMarkoutBps,
        },
      ];
    });

    return failures.length === 0
      ? undefined
      : {
          side,
          worstAverageMarkoutBps: Math.min(...failures.map((failure) => failure.averageMarkoutBps)),
          control: {
            disableOpen: true,
            reasonTags: failures.map((failure) => `quality_gate:${side}:${failure.reason}`),
          },
        };
  }
}

interface SideControlDecision {
  side: OrderSide;
  control: QuoteSideControls;
  worstAverageMarkoutBps: number;
}

function avoidFullQuoteBlackout(
  decisions: ReadonlyArray<SideControlDecision>,
  hasReduceInventorySide: boolean,
): SideControlDecision[] {
  const bidDecision = decisions.find((decision) => decision.side === "buy");
  const askDecision = decisions.find((decision) => decision.side === "sell");
  if (bidDecision === undefined || askDecision === undefined) {
    return [...decisions];
  }
  if (hasReduceInventorySide) {
    return [...decisions];
  }

  if (bidDecision.worstAverageMarkoutBps > askDecision.worstAverageMarkoutBps) {
    return decisions.filter((decision) => decision.side !== "buy");
  }
  if (askDecision.worstAverageMarkoutBps > bidDecision.worstAverageMarkoutBps) {
    return decisions.filter((decision) => decision.side !== "sell");
  }
  return [...decisions];
}

function formatThreshold(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}

function hasInventory(positionQty: number | undefined): boolean {
  return positionQty !== undefined && !isFlatPositionQty(positionQty);
}
