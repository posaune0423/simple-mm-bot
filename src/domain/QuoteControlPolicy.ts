import type { QuoteSideQuality, QuoteQualityHorizon } from "./QuoteQuality.ts";
import type { OrderSide } from "./entities/Quote.ts";
import type { QuoteControls, QuoteSideControls } from "./QuoteControls.ts";

export interface QuoteQualityGateConfig {
  enabled: boolean;
  minAverageMarkoutBps: number;
  minSamples: number;
  lookbackFills?: number;
  horizonsSec: number[];
}

export class QuoteControlPolicy {
  constructor(private readonly config: QuoteQualityGateConfig) {}

  controlsFor(quality: ReadonlyArray<QuoteSideQuality>): QuoteControls {
    if (!this.config.enabled) {
      return {};
    }

    const controls: QuoteControls = {};
    for (const sideQuality of quality) {
      const sideControl = this.sideControl(sideQuality.side, sideQuality.horizons);
      if (sideControl === undefined) {
        continue;
      }
      if (sideQuality.side === "buy") {
        controls.bid = sideControl;
      } else {
        controls.ask = sideControl;
      }
    }
    return controls;
  }

  private sideControl(
    side: OrderSide,
    horizons: ReadonlyArray<QuoteQualityHorizon>,
  ): QuoteSideControls | undefined {
    const reasons = this.config.horizonsSec.flatMap((horizonSec) => {
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
        `${horizonSec}s_markout_below_${formatThreshold(this.config.minAverageMarkoutBps)}bps`,
      ];
    });

    return reasons.length === 0
      ? undefined
      : {
          disableOpen: true,
          reasonTags: reasons.map((reason) => `quality_gate:${side}:${reason}`),
        };
  }
}

function formatThreshold(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}
