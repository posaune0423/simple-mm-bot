import { describe, expect, test } from "bun:test";

import { GuardRiskUseCase } from "../../../src/application/usecases/GuardRiskUseCase.ts";
import type { MarketSnapshot } from "../../../src/domain/ports/IMarketFeed.ts";

const healthySnapshot: MarketSnapshot = {
  market: "BTC-USD",
  bestBid: 99_990,
  bestAsk: 100_010,
  microPrice: 100_000,
  markPrice: 100_000,
  timestamp: Date.now(),
  marginRatio: 0.2,
};

describe("GuardRiskUseCase", () => {
  test("pauses quoting when the book component is stale", async () => {
    const now = Date.now();
    const useCase = new GuardRiskUseCase(
      feed({
        ...healthySnapshot,
        timestamp: now,
        bookUpdatedAt: now - 751,
        tickerUpdatedAt: now,
      }),
      {
        imrBuffer: 0.1,
        mmrBuffer: 0.05,
      },
    );

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "PAUSE_QUOTING",
        reason: "book_stale",
        market: "BTC-USD",
        bookAgeMs: expect.any(Number),
        tickerAgeMs: expect.any(Number),
        accountAgeMs: 0,
        positionAgeMs: 0,
      }),
    );
  });

  test("keeps the default 750ms book freshness gate", async () => {
    const now = Date.now();
    const useCase = new GuardRiskUseCase(
      feed({
        ...healthySnapshot,
        timestamp: now,
        bookUpdatedAt: now - 750,
        tickerUpdatedAt: now,
      }),
      {
        imrBuffer: 0.1,
        mmrBuffer: 0.05,
      },
    );

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "OK",
        bookAgeMs: expect.any(Number),
      }),
    );
  });

  test("uses configured book freshness threshold when provided", async () => {
    const now = Date.now();
    const useCase = new GuardRiskUseCase(
      feed({
        ...healthySnapshot,
        timestamp: now,
        bookUpdatedAt: now - 900,
        tickerUpdatedAt: now,
      }),
      {
        imrBuffer: 0.1,
        mmrBuffer: 0.05,
        maxBookAgeMs: 1_000,
      },
    );

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "OK",
        bookAgeMs: expect.any(Number),
      }),
    );
  });

  test("pauses when configured book freshness threshold is exceeded", async () => {
    const now = Date.now();
    const useCase = new GuardRiskUseCase(
      feed({
        ...healthySnapshot,
        timestamp: now,
        bookUpdatedAt: now - 1_001,
        tickerUpdatedAt: now,
      }),
      {
        imrBuffer: 0.1,
        mmrBuffer: 0.05,
        maxBookAgeMs: 1_000,
      },
    );

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "PAUSE_QUOTING",
        reason: "book_stale",
      }),
    );
  });

  test("pauses quoting when the ticker component is stale", async () => {
    const now = Date.now();
    const useCase = new GuardRiskUseCase(
      feed({
        ...healthySnapshot,
        timestamp: now,
        bookUpdatedAt: now,
        tickerUpdatedAt: now - 1_501,
      }),
      {
        imrBuffer: 0.1,
        mmrBuffer: 0.05,
      },
    );

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "PAUSE_QUOTING",
        reason: "ticker_stale",
      }),
    );
  });

  test("pauses quoting when account state is stale", async () => {
    const now = Date.now();
    const useCase = new GuardRiskUseCase(
      feed({
        ...healthySnapshot,
        timestamp: now,
        bookUpdatedAt: now,
        tickerUpdatedAt: now,
        accountUpdatedAt: now - 5_001,
        positionUpdatedAt: now,
      }),
      {
        imrBuffer: 0.1,
        mmrBuffer: 0.05,
      },
    );

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "PAUSE_QUOTING",
        reason: "account_stale",
      }),
    );
  });

  test("pauses quoting when position state is stale", async () => {
    const now = Date.now();
    const useCase = new GuardRiskUseCase(
      feed({
        ...healthySnapshot,
        timestamp: now,
        bookUpdatedAt: now,
        tickerUpdatedAt: now,
        accountUpdatedAt: now,
        positionUpdatedAt: now - 5_001,
      }),
      {
        imrBuffer: 0.1,
        mmrBuffer: 0.05,
      },
    );

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "PAUSE_QUOTING",
        reason: "position_stale",
      }),
    );
  });

  test("keeps legacy snapshots without component timestamps on the margin path", async () => {
    const useCase = new GuardRiskUseCase(feed(healthySnapshot), {
      imrBuffer: 0.1,
      mmrBuffer: 0.05,
    });

    expect(await useCase.execute()).toEqual(
      expect.objectContaining({
        state: "OK",
      }),
    );
  });
});

function feed(snapshot: MarketSnapshot) {
  return {
    async connect() {},
    async disconnect() {},
    async getSnapshot() {
      return snapshot;
    },
    subscribe() {
      return () => {};
    },
  };
}
