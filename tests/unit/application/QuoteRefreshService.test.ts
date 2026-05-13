import { describe, expect, test } from "bun:test";
import { ok, okAsync } from "neverthrow";

import type { OrderIntentBuilder } from "../../../src/application/services/OrderIntentBuilder.ts";
import type { OrderReconciler } from "../../../src/application/services/OrderReconciler.ts";
import { QuoteRefreshService } from "../../../src/application/services/QuoteRefreshService.ts";
import type { Fill } from "../../../src/domain/types/Fill.ts";
import type { Position } from "../../../src/domain/types/Position.ts";
import type { MarketSnapshot, SnapshotListener } from "../../../src/domain/ports/IMarketFeed.ts";
import type { IMarkoutFeedbackRepository } from "../../../src/domain/ports/IMarkoutFeedbackRepository.ts";
import type { IPositionRepository } from "../../../src/domain/ports/IPositionRepository.ts";
import {
  StrategyDecision,
  type Strategy,
  type StrategyInput,
} from "../../../src/domain/strategies/Strategy.ts";

describe("QuoteRefreshService", () => {
  test("treats markout feedback repository failures as an empty non-fatal signal", async () => {
    const strategyInputs: StrategyInput[] = [];
    const service = new QuoteRefreshService(
      new FixtureMarketFeed(),
      new FixturePositionRepository(),
      {
        name: "test_strategy",
        decide(input) {
          strategyInputs.push(input);
          return ok(
            StrategyDecision.noQuote({
              cancelExisting: false,
              reasonTags: ["test"],
              diagnostics: { strategy: "test_strategy" },
            }),
          );
        },
      } satisfies Strategy,
      {} as OrderIntentBuilder,
      {
        reconcile: () => okAsync({ activeOrders: [] }),
        cancelAll: (reason) => okAsync({ reason }),
      } satisfies OrderReconciler,
      { defaultTimeInForce: "ALO", postOnly: true },
      undefined,
      {
        getRecentSideMarkoutFeedback: async () => {
          throw new Error("sqlite locked");
        },
      } satisfies IMarkoutFeedbackRepository,
      { enabled: true, lookbackFills: 100, horizonsSec: [5, 30, 300] },
    );

    await service.execute();

    expect(strategyInputs).toHaveLength(1);
    expect(strategyInputs[0]?.markoutFeedback).toEqual([]);
  });
});

class FixtureMarketFeed {
  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async getSnapshot(): Promise<MarketSnapshot> {
    return {
      market: "BTC-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100,
      markPrice: 100,
      timestamp: Date.now(),
      marginRatio: null,
    };
  }

  subscribe(_listener: SnapshotListener): () => void {
    return () => {};
  }
}

class FixturePositionRepository implements IPositionRepository {
  async get(): Promise<Position> {
    return { qty: 0, avgEntry: 0, unrealizedPnl: 0 };
  }

  async update(_fill: Fill): Promise<Position> {
    return this.get();
  }

  async set(_position: Position): Promise<void> {}
}
