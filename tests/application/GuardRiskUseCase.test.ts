import { describe, expect, test } from "bun:test";

import { GuardRiskUseCase } from "../../src/application/usecases/GuardRiskUseCase.ts";
import type { MarketSnapshot } from "../../src/domain/ports/IMarketFeed.ts";

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

    expect(await useCase.execute()).toBe("PAUSE_QUOTING");
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

    expect(await useCase.execute()).toBe("PAUSE_QUOTING");
  });

  test("keeps legacy snapshots without component timestamps on the margin path", async () => {
    const useCase = new GuardRiskUseCase(feed(healthySnapshot), {
      imrBuffer: 0.1,
      mmrBuffer: 0.05,
    });

    expect(await useCase.execute()).toBe("OK");
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
