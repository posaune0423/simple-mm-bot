import { describe, expect, test } from "bun:test";

import { AlloraPredictionCache } from "../../../src/infrastructure/allora/AlloraPredictionCache.ts";

describe("AlloraPredictionCache", () => {
  test("calibrates raw inference drift and clamps to configured alpha bounds", async () => {
    const cache = new AlloraPredictionCache({
      client: client({
        network_inference: "102",
        confidence_interval_values: ["99", "101"],
        timestamp: 1000,
      }),
      fairPrice: () => 100,
      asset: "BTC",
      timeframe: "5m",
      pollIntervalMs: 60_000,
      staleMs: 420_000,
      calibrationWeight: 0.04,
      minAlphaDriftBps: 0.25,
      maxAlphaDriftBps: 3,
      maxRawDriftBps: 300,
      maxCiWidthBps: 250,
      nowMs: () => 1_000,
    });

    await cache.refreshOnce();

    expect(cache.current(1_000)).toMatchObject({
      alphaDriftBps: 3,
      stale: false,
      reason: "ok",
    });
  });

  test("fails closed when prediction is stale, outlier, or confidence interval is too wide", async () => {
    const stale = cacheFor(client({ network_inference: "101", timestamp: 1 }), () => 500_000);
    await stale.refreshOnce();
    expect(stale.current(500_000)).toMatchObject({ alphaDriftBps: 0, stale: true });

    const outlier = cacheFor(client({ network_inference: "200", timestamp: 1 }), () => 1);
    await outlier.refreshOnce();
    expect(outlier.current(1)).toMatchObject({ alphaDriftBps: 0, reason: "raw_outlier" });

    const wideCi = cacheFor(
      client({
        network_inference: "101",
        confidence_interval_values: ["90", "110"],
        timestamp: 1,
      }),
      () => 1,
    );
    await wideCi.refreshOnce();
    expect(wideCi.current(1)).toMatchObject({ alphaDriftBps: 0, reason: "ci_too_wide" });
  });

  test("stop cancels polling lifecycle", () => {
    const cache = cacheFor(client({ network_inference: "100", timestamp: 1 }), () => 1);

    cache.start();
    cache.stop();

    expect(cache.isRunning()).toBe(false);
  });
});

function cacheFor(
  client: ConstructorParameters<typeof AlloraPredictionCache>[0]["client"],
  nowMs: () => number,
) {
  return new AlloraPredictionCache({
    client,
    fairPrice: () => 100,
    asset: "BTC",
    timeframe: "5m",
    pollIntervalMs: 60_000,
    staleMs: 420_000,
    calibrationWeight: 0.04,
    minAlphaDriftBps: 0.25,
    maxAlphaDriftBps: 3,
    maxRawDriftBps: 200,
    maxCiWidthBps: 250,
    nowMs,
  });
}

function client(inference: {
  network_inference: string;
  confidence_interval_values?: string[];
  timestamp: number;
}) {
  return {
    async getPriceInference() {
      return {
        inference_data: {
          network_inference: inference.network_inference,
          confidence_interval_values: inference.confidence_interval_values ?? [],
          timestamp: inference.timestamp,
        },
      };
    },
  };
}
