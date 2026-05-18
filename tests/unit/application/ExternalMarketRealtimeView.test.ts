import { describe, expect, test } from "bun:test";

import {
  renderExternalMarketRealtimeLog,
  renderExternalMarketRealtimeTui,
} from "../../../src/application/services/ExternalMarketRealtimeView.ts";
import type { ExternalMarketRealtimeStatsSnapshot } from "../../../src/application/services/ExternalMarketRealtimeStats.ts";

describe("ExternalMarketRealtimeView", () => {
  test("renders log mode as one structured JSON event", () => {
    const line = renderExternalMarketRealtimeLog(snapshot, {
      status: "ready",
      fairMid: 100.5,
      fairBid: 100,
      fairAsk: 101,
      maxAgeMs: 120,
      storeVersion: 4,
      excludedCount: 0,
    });

    expect(JSON.parse(line)).toEqual({
      event: "external_market_realtime",
      elapsedMs: 2_000,
      windowMs: 5_000,
      totalUpdates: 12,
      fairValue: {
        status: "ready",
        fairMid: 100.5,
        fairBid: 100,
        fairAsk: 101,
        maxAgeMs: 120,
        storeVersion: 4,
        excludedCount: 0,
      },
      sources: [
        {
          venue: "binance_usdm",
          symbol: "BTCUSDT",
          status: "live",
          bid: 100,
          ask: 101,
          mid: 100.5,
          spreadBps: 0.01301234,
          ageMs: 120,
          lastPriceChangeAgeMs: 320,
          recentHz: 1.8,
          recentPriceHz: 0.4,
          avgHz: 6,
          avgPriceHz: 2,
          totalUpdates: 12,
          totalPriceChanges: 4,
        },
      ],
    });
  });

  test("renders tui mode as an updating table with prices and Hz", () => {
    const output = renderExternalMarketRealtimeTui(snapshot, {
      status: "ready",
      fairMid: 100.5,
      fairBid: 100,
      fairAsk: 101,
      maxAgeMs: 120,
      storeVersion: 4,
      excludedCount: 0,
    });

    expect(output).toContain("\x1b[2J\x1b[H");
    expect(output).toContain("External Market Realtime");
    expect(output).toContain("fair=ready");
    expect(output).toContain("binance_usdm");
    expect(output).toContain("100.0000");
    expect(output).toContain("0.01301234");
    expect(output).toContain("1.80");
    expect(output).toContain("0.40");
    expect(output).toContain("320");
  });
});

const snapshot: ExternalMarketRealtimeStatsSnapshot = {
  elapsedMs: 2_000,
  windowMs: 5_000,
  totalUpdates: 12,
  rows: [
    {
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      status: "live",
      bidPrice: 100,
      askPrice: 101,
      midPrice: 100.5,
      spreadBps: 0.01301234,
      ageMs: 120,
      lastPriceChangeAgeMs: 320,
      totalUpdates: 12,
      totalPriceChanges: 4,
      recentUpdates: 9,
      recentPriceChanges: 2,
      recentUpdatesPerSecond: 1.8,
      recentPriceChangesPerSecond: 0.4,
      averageUpdatesPerSecond: 6,
      averagePriceChangesPerSecond: 2,
    },
  ],
};
