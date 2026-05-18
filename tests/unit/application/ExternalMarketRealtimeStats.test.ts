import { describe, expect, test } from "bun:test";

import { ExternalMarketRealtimeStats } from "../../../src/application/services/ExternalMarketRealtimeStats.ts";
import type { ExternalMarketSourceConfig } from "../../../src/domain/external-market/ExternalMarketTypes.ts";

describe("ExternalMarketRealtimeStats", () => {
  test("reports per-source latest prices and rolling update frequency", () => {
    const stats = new ExternalMarketRealtimeStats(sources, {
      startedAt: 1_000,
      windowMs: 1_000,
    });

    stats.recordTopOfBook(topOfBook("binance_usdm", "BTCUSDT", 1_100, 100, 101));
    stats.recordTopOfBook(topOfBook("binance_usdm", "BTCUSDT", 1_600, 101, 102));
    stats.recordTopOfBook(topOfBook("okx_swap", "BTC-USDT-SWAP", 1_900, 99, 100));
    stats.recordTopOfBook(topOfBook("binance_usdm", "BTCUSDT", 2_300, 102, 103));

    const snapshot = stats.snapshot(2_400);

    expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.rows[0]).toMatchObject({
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      bidPrice: 102,
      askPrice: 103,
      midPrice: 102.5,
      ageMs: 100,
      lastPriceChangeAgeMs: 100,
      totalUpdates: 3,
      recentUpdates: 2,
      totalPriceChanges: 3,
      recentPriceChanges: 2,
    });
    expect(snapshot.rows[0]?.recentUpdatesPerSecond).toBe(2);
    expect(snapshot.rows[0]?.recentPriceChangesPerSecond).toBe(2);
    expect(snapshot.rows[0]?.averageUpdatesPerSecond).toBeCloseTo(3 / 1.4, 6);
    expect(snapshot.rows[0]?.averagePriceChangesPerSecond).toBeCloseTo(3 / 1.4, 6);
    expect(snapshot.rows[1]).toMatchObject({
      venue: "okx_swap",
      symbol: "BTC-USDT-SWAP",
      bidPrice: 99,
      askPrice: 100,
      ageMs: 500,
      lastPriceChangeAgeMs: 500,
      totalUpdates: 1,
      recentUpdates: 1,
      totalPriceChanges: 1,
      recentPriceChanges: 1,
    });
    expect(snapshot.totalUpdates).toBe(4);
    expect(snapshot.windowMs).toBe(1_000);
  });

  test("keeps configured sources visible while waiting for first update", () => {
    const stats = new ExternalMarketRealtimeStats(sources, {
      startedAt: 1_000,
      windowMs: 1_000,
    });

    const snapshot = stats.snapshot(1_500);

    expect(snapshot.rows).toEqual([
      {
        venue: "binance_usdm",
        symbol: "BTCUSDT",
        status: "waiting",
        ageMs: undefined,
        bidPrice: undefined,
        askPrice: undefined,
        midPrice: undefined,
        spreadBps: undefined,
        totalUpdates: 0,
        recentUpdates: 0,
        totalPriceChanges: 0,
        recentPriceChanges: 0,
        averageUpdatesPerSecond: 0,
        recentUpdatesPerSecond: 0,
        averagePriceChangesPerSecond: 0,
        recentPriceChangesPerSecond: 0,
      },
      {
        venue: "okx_swap",
        symbol: "BTC-USDT-SWAP",
        status: "waiting",
        ageMs: undefined,
        bidPrice: undefined,
        askPrice: undefined,
        midPrice: undefined,
        spreadBps: undefined,
        totalUpdates: 0,
        recentUpdates: 0,
        totalPriceChanges: 0,
        recentPriceChanges: 0,
        averageUpdatesPerSecond: 0,
        recentUpdatesPerSecond: 0,
        averagePriceChangesPerSecond: 0,
        recentPriceChangesPerSecond: 0,
      },
    ]);
  });

  test("separates received updates from unchanged price updates", () => {
    const stats = new ExternalMarketRealtimeStats(sources, {
      startedAt: 1_000,
      windowMs: 1_000,
    });

    stats.recordTopOfBook(topOfBook("binance_usdm", "BTCUSDT", 1_100, 100, 101));
    stats.recordTopOfBook(topOfBook("binance_usdm", "BTCUSDT", 1_300, 100, 101));
    stats.recordTopOfBook(topOfBook("binance_usdm", "BTCUSDT", 1_500, 100, 101));

    const row = stats.snapshot(1_600).rows[0];

    expect(row).toMatchObject({
      totalUpdates: 3,
      recentUpdates: 3,
      totalPriceChanges: 1,
      recentPriceChanges: 1,
      lastPriceChangeAgeMs: 500,
    });
    expect(row?.recentUpdatesPerSecond).toBe(3);
    expect(row?.recentPriceChangesPerSecond).toBe(1);
  });

  test("rejects non-positive rolling windows", () => {
    expect(() => new ExternalMarketRealtimeStats(sources, { windowMs: 0 })).toThrow(
      "ExternalMarketRealtimeStats windowMs must be positive",
    );
  });
});

const sources: ExternalMarketSourceConfig[] = [
  { venue: "binance_usdm", symbol: "BTCUSDT", weight: 0.5 },
  { venue: "okx_swap", symbol: "BTC-USDT-SWAP", weight: 0.3 },
];

function topOfBook(
  venue: ExternalMarketSourceConfig["venue"],
  symbol: string,
  receivedAt: number,
  bidPrice: number,
  askPrice: number,
) {
  const midPrice = (bidPrice + askPrice) / 2;
  return {
    id: `${venue}-${receivedAt}`,
    venue,
    symbol,
    receivedAt,
    bidPrice,
    bidSize: 1,
    askPrice,
    askSize: 1,
    midPrice,
    spreadBps: ((askPrice - bidPrice) / midPrice) * 10_000,
  };
}
