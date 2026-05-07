import { describe, expect, test } from "bun:test";

import { buildQuotingStrategy } from "../../src/application/QuotingStrategyFactory.ts";
import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";
import { BulkBetaLeaderboardStrategy } from "../../src/domain/strategy/bulk-beta-leaderboard/BulkBetaLeaderboardStrategy.ts";

describe("buildQuotingStrategy", () => {
  test("builds Avellaneda-Stoikov from discriminated strategy config", () => {
    const strategy = buildQuotingStrategy({
      type: "avellaneda-stoikov",
      params: { gamma: 0.02, kappa: 1.5, kInv: 0.3 },
    });

    expect(strategy).toBeInstanceOf(AvellanedaStoikovStrategy);
    expect(strategy.name).toBe("avellaneda-stoikov");
  });

  test("builds Bulk beta leaderboard strategy from discriminated strategy config", () => {
    const strategy = buildQuotingStrategy({
      type: "bulk-beta-leaderboard",
      params: {
        baseHalfSpreadBps: 2.5,
        minHalfSpreadBps: 1.2,
        maxHalfSpreadBps: 8,
        volatilitySpreadMultiplier: 1.5,
        inventorySoftLimitQty: 0.08,
        inventoryHardLimitQty: 0.18,
        sameSideSizeMultiplierAtSoft: 0.25,
        reduceSideSizeMultiplierAtSoft: 1.8,
      },
    });

    expect(strategy).toBeInstanceOf(BulkBetaLeaderboardStrategy);
    expect(strategy.name).toBe("bulk-beta-leaderboard");
  });
});
