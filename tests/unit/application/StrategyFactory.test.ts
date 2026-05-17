import { describe, expect, test } from "bun:test";

import { buildStrategy } from "../../../src/application/factories/StrategyFactory";
import type { QuoteEngine } from "../../../src/domain/services/QuoteEngine";
import { FundingAwarePmmStrategy } from "../../../src/domain/strategies/FundingAwarePmmStrategy";
import { SimplePmmStrategy } from "../../../src/domain/strategies/SimplePmmStrategy";

describe("buildStrategy", () => {
  test("builds the baseline SimplePmmStrategy", () => {
    const quoteEngine: Pick<QuoteEngine, "compute"> = {
      compute() {
        throw new Error("not called");
      },
    };

    const strategy = buildStrategy({
      kind: "simple_pmm",
      quoteEngine,
      markoutFeedbackGate: {
        enabled: false,
        minAverageMarkoutBps: 0,
        minSamples: 20,
        horizonsSec: [5, 30, 300],
      },
    });

    expect(strategy).toBeInstanceOf(SimplePmmStrategy);
    expect(strategy.name).toBe("simple_pmm");
  });

  test("builds the funding-aware PMM strategy", () => {
    const quoteEngine: Pick<QuoteEngine, "compute"> = {
      compute() {
        throw new Error("not called");
      },
    };

    const strategy = buildStrategy({
      kind: "funding_aware_pmm",
      quoteEngine,
      markoutFeedbackGate: {
        enabled: false,
        minAverageMarkoutBps: 0,
        minSamples: 20,
        horizonsSec: [5, 30, 300],
      },
      fundingAware: {
        alpha: { enabled: false },
        targetInventory: {
          maxQty: 0.35,
          alphaQtyPerBps: 0.025,
        },
        funding: {
          rateHorizonSec: 3600,
          holdingHorizonSec: 300,
        },
      },
    });

    expect(strategy).toBeInstanceOf(FundingAwarePmmStrategy);
    expect(strategy.name).toBe("funding_aware_pmm");
  });
});
