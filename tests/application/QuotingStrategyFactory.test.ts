import { describe, expect, test } from "bun:test";

import { buildQuotingStrategy } from "../../src/application/QuotingStrategyFactory.ts";
import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";

describe("buildQuotingStrategy", () => {
  test("builds Avellaneda-Stoikov from discriminated strategy config", () => {
    const strategy = buildQuotingStrategy({
      type: "avellaneda-stoikov",
      params: { gamma: 0.02, kappa: 1.5, kInv: 0.3 },
    });

    expect(strategy).toBeInstanceOf(AvellanedaStoikovStrategy);
    expect(strategy.name).toBe("avellaneda-stoikov");
  });

  test("does not build legacy ladder strategy types as active strategies", () => {
    expect(() =>
      buildQuotingStrategy({
        type: "bulk-beta-leaderboard",
        params: {},
      } as never),
    ).toThrow("Unsupported quoting strategy type: bulk-beta-leaderboard");
  });
});
