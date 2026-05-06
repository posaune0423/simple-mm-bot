import { describe, expect, test } from "bun:test";

import { Bot } from "../../src/application/Bot.ts";
import type { MarketSnapshot } from "../../src/domain/ports/IMarketFeed.ts";
import { logger } from "../../src/utils/logger.ts";

function captureLogs() {
  const info = logger.info;
  const debug = logger.debug;
  const warn = logger.warn;
  const error = logger.error;
  const messages: string[] = [];
  logger.info = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  logger.debug = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  logger.warn = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  logger.error = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  return {
    messages,
    restore() {
      logger.info = info;
      logger.debug = debug;
      logger.warn = warn;
      logger.error = error;
    },
  };
}

describe("Bot", () => {
  test("stops immediately on emergency risk state", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "EMERGENCY_STOP" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        recordFill: {
          execute: async () => {
            calls.push("fill");
          },
        },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
          },
        },
        buildReport: {
          execute: async () => ({
            id: "r1",
            mode: "paper" as const,
            venue: "hyperliquid",
            periodStart: 0,
            periodEnd: 1,
            metrics: {
              netPnl: 0,
              tradePnl: 0,
              markout5s: 0,
              markout30s: 0,
              maxDrawdown: 0,
              sharpe: 0,
              fillRate: 0,
            },
            equityCurve: [],
            fillAnalysis: { adverseSelectionCount: 0, fillCount: 0 },
          }),
        },
      },
      {
        async connect() {},
        async disconnect() {},
        async getSnapshot() {
          return {
            market: "ETH",
            bestBid: 99,
            bestAsk: 101,
            microPrice: 100,
            markPrice: 100,
            timestamp: 1,
            marginRatio: 0.01,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("should not place");
        },
        async cancel() {},
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          return () => {};
        },
      },
      1,
    );

    await bot.start(1);

    expect(calls).toEqual(["cancelAll", "cancelAll", "closePosition"]);
  });

  test("cleans up subscriptions and order gateway lifecycle after stopping", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        recordFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
          },
        },
        buildReport: {
          execute: async () => ({
            id: "r1",
            mode: "paper" as const,
            venue: "bulk",
            periodStart: 0,
            periodEnd: 1,
            metrics: {
              netPnl: 0,
              tradePnl: 0,
              markout5s: 0,
              markout30s: 0,
              maxDrawdown: 0,
              sharpe: 0,
              fillRate: 0,
            },
            equityCurve: [],
            fillAnalysis: { adverseSelectionCount: 0, fillCount: 0 },
          }),
        },
      },
      {
        async connect() {
          calls.push("connect");
        },
        async disconnect() {
          calls.push("disconnect");
        },
        async getSnapshot() {
          return {
            market: "BTC-USD",
            bestBid: 99,
            bestAsk: 101,
            microPrice: 100,
            markPrice: 100,
            timestamp: 1,
            marginRatio: null,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("unused");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          calls.push("subscribe");
          return () => {
            calls.push("unsubscribe");
          };
        },
        dispose() {
          calls.push("dispose");
        },
      },
      1,
    );

    await bot.start(1);

    expect(calls).toEqual([
      "connect",
      "subscribe",
      "refresh",
      "closePosition",
      "disconnect",
      "unsubscribe",
      "dispose",
    ]);
  });

  test("propagates close-position cleanup failures after disconnecting and disposing", async () => {
    const logs = captureLogs();
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        recordFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
            throw new Error("close failed");
          },
        },
        buildReport: {
          execute: async () => {
            calls.push("buildReport");
            throw new Error("should not build report");
          },
        },
      },
      {
        async connect() {
          calls.push("connect");
        },
        async disconnect() {
          calls.push("disconnect");
        },
        async getSnapshot() {
          return {
            market: "BTC-USD",
            bestBid: 99,
            bestAsk: 101,
            microPrice: 100,
            markPrice: 100,
            timestamp: 1,
            marginRatio: null,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("unused");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          calls.push("subscribe");
          return () => {
            calls.push("unsubscribe");
          };
        },
        dispose() {
          calls.push("dispose");
        },
      },
      1,
    );

    try {
      await bot.start(1).then(
        () => {
          throw new Error("Expected cleanup failure");
        },
        (error) => {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe("close failed");
        },
      );
    } finally {
      logs.restore();
    }

    expect(calls).toEqual([
      "connect",
      "subscribe",
      "refresh",
      "closePosition",
      "disconnect",
      "unsubscribe",
      "dispose",
    ]);
    expect(logs.messages).toContain("bot.cleanup_failed quotedCount=2 closePositionFailed=true");
    expect(logs.messages).not.toContain("bot.cleanup_complete quotedCount=2");
  });

  test("preserves the startup failure when close-position cleanup also fails", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
            throw new Error("refresh failed");
          },
        },
        recordFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
            throw new Error("close failed");
          },
        },
        buildReport: {
          execute: async () => {
            throw new Error("report should not be built");
          },
        },
      },
      {
        async connect() {
          calls.push("connect");
        },
        async disconnect() {
          calls.push("disconnect");
        },
        async getSnapshot() {
          return {
            market: "BTC-USD",
            bestBid: 99,
            bestAsk: 101,
            microPrice: 100,
            markPrice: 100,
            timestamp: 1,
            marginRatio: null,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("unused");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          calls.push("subscribe");
          return () => {
            calls.push("unsubscribe");
          };
        },
        dispose() {
          calls.push("dispose");
        },
      },
      1,
    );

    let error: unknown;
    try {
      await bot.start(1);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("refresh failed");
    expect(calls).toEqual([
      "connect",
      "subscribe",
      "refresh",
      "closePosition",
      "disconnect",
      "unsubscribe",
      "dispose",
    ]);
  });

  test("records initial and streamed market snapshots as OHLCV input", async () => {
    const recorded: number[] = [];
    let marketListener: ((snapshot: MarketSnapshot) => void) | undefined;
    const marketFeed = {
      async connect() {},
      async disconnect() {},
      async getSnapshot() {
        return {
          market: "BTC-USD",
          bestBid: 99,
          bestAsk: 101,
          microPrice: 100,
          markPrice: 100,
          timestamp: 1_700_000_012_345,
          volume: 2,
          marginRatio: null,
        };
      },
      subscribe(listener: (snapshot: MarketSnapshot) => void) {
        marketListener = listener;
        return () => {};
      },
    };
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            marketListener?.({
              market: "BTC-USD",
              bestBid: 100,
              bestAsk: 102,
              microPrice: 101,
              markPrice: 101,
              timestamp: 1_700_000_045_000,
              volume: 3,
              marginRatio: null,
            });
          },
        },
        recordFill: { execute: async () => {} },
        recordOhlcv: {
          execute: async (snapshot) => {
            recorded.push(snapshot.markPrice);
          },
        },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
        buildReport: {
          execute: async () => ({
            id: "r1",
            mode: "paper" as const,
            venue: "bulk",
            periodStart: 0,
            periodEnd: 1,
            metrics: {
              netPnl: 0,
              tradePnl: 0,
              markout5s: 0,
              markout30s: 0,
              maxDrawdown: 0,
              sharpe: 0,
              fillRate: 0,
            },
            equityCurve: [],
            fillAnalysis: { adverseSelectionCount: 0, fillCount: 0 },
          }),
        },
      },
      marketFeed,
      {
        async place() {
          throw new Error("unused");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
        dispose() {},
      },
      1,
    );

    await bot.start(1);

    expect(recorded).toEqual([100, 101]);
  });

  test("logs lifecycle, tick state, and cleanup", async () => {
    const logs = captureLogs();
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: { execute: async () => {} },
        recordFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
        buildReport: {
          execute: async () => ({
            id: "r1",
            mode: "paper" as const,
            venue: "bulk",
            periodStart: 0,
            periodEnd: 1,
            metrics: {
              netPnl: 0,
              tradePnl: 0,
              markout5s: 0,
              markout30s: 0,
              maxDrawdown: 0,
              sharpe: 0,
              fillRate: 0,
            },
            equityCurve: [],
            fillAnalysis: { adverseSelectionCount: 0, fillCount: 0 },
          }),
        },
      },
      {
        async connect() {},
        async disconnect() {},
        async getSnapshot() {
          return {
            market: "BTC-USD",
            bestBid: 99,
            bestAsk: 101,
            microPrice: 100,
            markPrice: 100,
            timestamp: 1,
            marginRatio: null,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("unused");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
        dispose() {},
      },
      1,
    );

    try {
      await bot.start(1);

      expect(logs.messages).toContain("bot.start intervalMs=1 maxTicks=1");
      expect(logs.messages).toContain("bot.market_feed_connected");
      expect(logs.messages).toContain("bot.tick tick=1 riskState=OK");
      expect(logs.messages).toContain("bot.stopping reason=max_ticks tick=1");
      expect(logs.messages).toContain("bot.cleanup_complete quotedCount=2");
    } finally {
      logs.restore();
    }
  });
});
