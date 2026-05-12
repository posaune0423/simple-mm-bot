import { describe, expect, test } from "bun:test";

import { buildStrategy } from "../../../src/application/factories/StrategyFactory";
import { SimplePmmStrategy } from "../../../src/domain/strategies/SimplePmmStrategy";

describe("buildStrategy", () => {
  test("builds the baseline SimplePmmStrategy", () => {
    const strategy = buildStrategy({
      kind: "simple_pmm",
      quoteEngine: {
        compute() {
          throw new Error("not called");
        },
      } as never,
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
});
