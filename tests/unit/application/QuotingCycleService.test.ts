import { describe, expect, test } from "bun:test";
import { err, errAsync, ok, okAsync } from "neverthrow";

import {
  OrderReconcileFailedError,
  type ManagedOrderReconciler,
} from "../../../src/application/services/ManagedOrderReconciler.ts";
import { OrderIntentBuilder } from "../../../src/application/services/OrderIntentBuilder.ts";
import { QuotingCycleService } from "../../../src/application/services/QuotingCycleService.ts";
import { StrategyQuoteFailedError } from "../../../src/domain/errors/DomainError.ts";
import type { Fill } from "../../../src/domain/types/Fill.ts";
import type { OrderIntent } from "../../../src/domain/value-objects/OrderIntent.ts";
import type { Position } from "../../../src/domain/types/Position.ts";
import type { MarketSnapshot, SnapshotListener } from "../../../src/domain/ports/IMarketFeed.ts";
import type { IMarkoutFeedbackRepository } from "../../../src/domain/ports/IMarkoutFeedbackRepository.ts";
import type { IPositionRepository } from "../../../src/domain/ports/IPositionRepository.ts";
import {
  StrategyDecision,
  type Strategy,
  type StrategyInput,
} from "../../../src/domain/strategies/Strategy.ts";
import { Price } from "../../../src/domain/value-objects/Price.ts";
import { Quantity } from "../../../src/domain/value-objects/Quantity.ts";
import { Quote } from "../../../src/domain/value-objects/Quote.ts";
import { QuoteLeg } from "../../../src/domain/value-objects/QuoteLeg.ts";

describe("QuotingCycleService", () => {
  test("treats markout feedback repository failures as an empty non-fatal signal", async () => {
    const strategyInputs: StrategyInput[] = [];
    const service = new QuotingCycleService(
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
      new OrderIntentBuilder(),
      {
        reconcile: () => okAsync({ activeOrders: [] }),
        cancelAll: (reason) => okAsync({ reason }),
      } satisfies Pick<ManagedOrderReconciler, "reconcile" | "cancelAll">,
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

  test("propagates reconcile failures so the bot fails closed", async () => {
    const service = new QuotingCycleService(
      new FixtureMarketFeed(),
      new FixturePositionRepository(),
      quoteStrategy(),
      new OrderIntentBuilder(),
      {
        reconcile: () => errAsync(new OrderReconcileFailedError(new Error("cancel failed"))),
        cancelAll: (reason) => okAsync({ reason }),
      } satisfies Pick<ManagedOrderReconciler, "reconcile" | "cancelAll">,
      { defaultTimeInForce: "GTC", postOnly: false },
    );

    await expectRejects(service.execute(), "order reconciliation failed");
  });

  test("cancels resting orders and propagates strategy failures", async () => {
    const cancelReasons: string[] = [];
    const service = new QuotingCycleService(
      new FixtureMarketFeed(),
      new FixturePositionRepository(),
      {
        name: "test_strategy",
        decide() {
          return err(new StrategyQuoteFailedError("test_strategy", "quote must contain a leg"));
        },
      } satisfies Strategy,
      new OrderIntentBuilder(),
      {
        reconcile: () => okAsync({ activeOrders: [] }),
        cancelAll: (reason) => {
          cancelReasons.push(reason);
          return okAsync({ reason });
        },
      } satisfies Pick<ManagedOrderReconciler, "reconcile" | "cancelAll">,
      { defaultTimeInForce: "GTC", postOnly: false },
    );

    await expectRejects(service.execute(), "quote must contain a leg");

    expect(cancelReasons).toEqual(["strategy_decision_failed"]);
  });

  test("switches quote intents to IOC when margin is below the slide threshold", async () => {
    let reconciledIntents: readonly OrderIntent[] = [];
    const service = new QuotingCycleService(
      new FixtureMarketFeed({ marginRatio: 0.1 }),
      new FixturePositionRepository(),
      quoteStrategy(),
      new OrderIntentBuilder(),
      {
        reconcile: (intents) => {
          reconciledIntents = intents;
          return okAsync({ activeOrders: [] });
        },
        cancelAll: (reason) => okAsync({ reason }),
      } satisfies Pick<ManagedOrderReconciler, "reconcile" | "cancelAll">,
      { defaultTimeInForce: "GTC", postOnly: false, slideMarginThreshold: 0.12 },
    );

    await service.execute();

    expect(reconciledIntents).toHaveLength(2);
    expect(reconciledIntents.every((intent) => intent.timeInForce === "IOC")).toBe(true);
    expect(reconciledIntents.every((intent) => intent.postOnly === false)).toBe(true);
  });
});

class FixtureMarketFeed {
  constructor(private readonly overrides: Partial<MarketSnapshot> = {}) {}

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
      ...this.overrides,
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

function quoteStrategy(): Strategy {
  return {
    name: "test_strategy",
    decide() {
      return ok(
        StrategyDecision.quote({
          quote: Quote.create({
            market: "BTC-USD",
            bids: [
              QuoteLeg.unsafe({
                side: "bid",
                price: Price.unsafe(99),
                size: Quantity.unsafe(1),
                level: 0,
                exposureIntent: "increase_exposure",
              }),
            ],
            asks: [
              QuoteLeg.unsafe({
                side: "ask",
                price: Price.unsafe(101),
                size: Quantity.unsafe(1),
                level: 0,
                exposureIntent: "increase_exposure",
              }),
            ],
            referencePrice: Price.unsafe(100),
            fairPrice: Price.unsafe(100),
            sigma: 0.01,
            diagnostics: { quoteModel: "stub", reasonTags: [] },
          })._unsafeUnwrap(),
          reasonTags: [],
          diagnostics: { strategy: "test_strategy", quoteModel: "stub" },
        }),
      );
    },
  };
}

async function expectRejects(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
  }
}
