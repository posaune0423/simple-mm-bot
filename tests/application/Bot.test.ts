import { describe, expect, spyOn, test } from "bun:test";

import { Bot } from "../../src/application/Bot.ts";
import type { MarketSnapshot, SnapshotListener } from "../../src/domain/ports/IMarketFeed.ts";
import type { FillListener, OrderEventListener } from "../../src/domain/ports/IOrderGateway.ts";
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
  test("does not build or persist a legacy report after a successful run", async () => {
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: { execute: async () => {} },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
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
            marginRatio: null,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place(order) {
          return { id: "quote", request: order, status: "open" as const };
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          return () => {};
        },
      },
      1,
    );

    await bot.start(1);
  });

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
        updatePositionOnFill: {
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

    expect(calls).toEqual(["cancelAll", "closePosition"]);
  });

  test("initializes the live position before placing the first quote", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        initializePosition: {
          execute: async () => {
            calls.push("initializePosition");
          },
        },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
      },
      {
        async connect() {
          calls.push("connect");
        },
        async disconnect() {},
        async getSnapshot() {
          return {
            market: "ETH",
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
        async place(order) {
          return { id: "quote", request: order, status: "open" as const };
        },
        async cancel() {},
        async cancelAll() {},
        async syncFills() {
          calls.push("syncFills");
        },
        subscribeFills() {
          return () => {};
        },
      },
      1,
    );

    await bot.start(1);

    expect(calls.slice(0, 4)).toEqual(["connect", "syncFills", "initializePosition", "refresh"]);
  });

  test("runs inventory reduction before normal quote refresh and skips quotes when reducing", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: {
          execute: async () => {
            calls.push("guard");
            return "OK" as const;
          },
        },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: {
          executeIfNeeded: async () => {
            calls.push("reduce");
            return true;
          },
        },
        closePosition: { execute: async () => {} },
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
      },
      1,
      undefined,
      { closePositionPolicy: "emergency_only" },
    );

    await bot.start(1);

    expect(calls).toEqual(["guard", "reduce"]);
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
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
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
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          calls.push("subscribe");
          return () => {
            calls.push("unsubscribe");
          };
        },
        stopBackgroundSync() {
          calls.push("stopBackgroundSync");
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
      "stopBackgroundSync",
      "cancelAll",
      "closePosition",
      "disconnect",
      "unsubscribe",
      "dispose",
    ]);
  });

  test("skips normal-stop market close when shutdown policy is emergency only", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
          },
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
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          return () => {};
        },
      },
      1,
      undefined,
      { closePositionPolicy: "emergency_only" },
    );

    await bot.start(1);

    expect(calls).toEqual(["refresh", "cancelAll"]);
  });

  test("still closes positions on emergency stop with emergency-only shutdown policy", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "EMERGENCY_STOP" as const },
        refreshQuotes: { execute: async () => {} },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
          },
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
            marginRatio: 0.01,
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
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          return () => {};
        },
      },
      1,
      undefined,
      { closePositionPolicy: "emergency_only" },
    );

    await bot.start(1);

    expect(calls).toEqual(["cancelAll", "closePosition"]);
  });

  test("syncs existing fills before subscribing to live fill events", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "EMERGENCY_STOP" as const },
        refreshQuotes: { execute: async () => {} },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
      },
      {
        async connect() {
          calls.push("connect");
        },
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
          calls.push("subscribeFills");
          return () => {};
        },
        async syncFills() {
          calls.push("syncFills");
        },
      },
      1,
    );

    await bot.start(1);

    expect(calls).toEqual(["connect", "syncFills", "subscribeFills"]);
  });

  test("does not sleep after stop is requested during a tick", async () => {
    const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {});
    let stopBot = () => {};
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            stopBot();
          },
        },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
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
      },
      60_000,
    );
    stopBot = () => bot.stop();

    try {
      await bot.start();
    } finally {
      sleep.mockRestore();
    }

    expect(sleep).not.toHaveBeenCalled();
  });

  test("does not propagate an in-flight tick failure after shutdown is requested", async () => {
    const calls: string[] = [];
    let stopBot = () => {};
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: { execute: async () => {} },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: {
          executeIfNeeded: async () => {
            stopBot();
            calls.push("reduce");
            throw new Error("HTTP error 408");
          },
        },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
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
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          return () => {};
        },
      },
      1,
    );
    stopBot = () => bot.stop();

    await bot.start();

    expect(calls).toEqual(["connect", "reduce", "cancelAll", "closePosition", "disconnect"]);
  });

  test("continues after a transient Bulk 408 during a live tick", async () => {
    const logs = captureLogs();
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
            if (calls.filter((call) => call === "refresh").length === 1) {
              throw Object.assign(new Error("HTTP error 408"), {
                name: "BulkHttpError",
                status: 408,
              });
            }
          },
        },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
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
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          return () => {};
        },
      },
      1,
    );

    try {
      await bot.start(2);
    } finally {
      logs.restore();
    }

    expect(calls).toEqual(["connect", "refresh", "refresh", "cancelAll", "disconnect"]);
    expect(logs.messages).toContain(
      "bot.tick_transient_error tick=1 error=BulkHttpError: HTTP error 408",
    );
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
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
            throw new Error("close failed");
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
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          calls.push("subscribe");
          return () => {
            calls.push("unsubscribe");
          };
        },
        stopBackgroundSync() {
          calls.push("stopBackgroundSync");
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
      "stopBackgroundSync",
      "cancelAll",
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
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: {
          execute: async () => {
            calls.push("closePosition");
            throw new Error("close failed");
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
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: {
          execute: async (snapshot) => {
            recorded.push(snapshot.markPrice);
          },
        },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
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

  test("serializes subscribed snapshot and fill handlers before continuing the tick", async () => {
    const calls: string[] = [];
    let marketListener: SnapshotListener | undefined;
    let fillListener: FillListener | undefined;
    let orderListener: OrderEventListener | undefined;

    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            void marketListener?.({
              market: "BTC-USD",
              bestBid: 100,
              bestAsk: 102,
              microPrice: 101,
              markPrice: 101,
              timestamp: 2,
              volume: 1,
              marginRatio: null,
            });
            void fillListener?.({
              id: "fill-1",
              venue: "bulk",
              market: "BTC-USD",
              side: "buy",
              price: 100,
              qty: 1,
              fee: 0,
              tradePnl: 0,
              filledAt: 2,
            });
            void orderListener?.({
              action: "submit",
              orderId: "order-1",
              side: "buy",
              price: 100,
              qty: 1,
              status: "placed",
              latencyMs: 1,
            });
          },
        },
        updatePositionOnFill: {
          execute: async () => {
            calls.push("fill");
          },
        },
        recordOhlcv: {
          execute: async (snapshot) => {
            if (snapshot.timestamp === 2) {
              calls.push("ohlcv:2:start");
              await Promise.resolve();
              calls.push("ohlcv:2:end");
              return;
            }
            calls.push(`ohlcv:${snapshot.timestamp}`);
          },
        },
        reduceInventory: {
          executeIfNeeded: async () => {
            calls.push("reduce");
            return false;
          },
        },
        closePosition: { execute: async () => {} },
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
            volume: 1,
            marginRatio: null,
          };
        },
        subscribe(listener) {
          marketListener = listener;
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("unused");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills(listener) {
          fillListener = listener;
          return () => {};
        },
        subscribeOrderEvents(listener) {
          orderListener = listener;
          return () => {};
        },
        dispose() {},
      },
      1,
    );

    await bot.start(1);

    expect(calls).toEqual(["ohlcv:1", "reduce", "ohlcv:2:start", "ohlcv:2:end", "fill"]);
  });

  test("continues quoting when a subscribed event task stalls", async () => {
    let marketListener: SnapshotListener | undefined;
    let quoteCount = 0;
    const logs = captureLogs();

    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            quoteCount += 1;
            void marketListener?.({
              market: "BTC-USD",
              bestBid: 100,
              bestAsk: 102,
              microPrice: 101,
              markPrice: 101,
              timestamp: quoteCount + 1,
              volume: 1,
              marginRatio: null,
            });
          },
        },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: {
          execute: async (snapshot) => {
            if (snapshot.timestamp === 2) {
              await new Promise<void>(() => {});
            }
          },
        },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
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
            volume: 1,
            marginRatio: null,
          };
        },
        subscribe(listener) {
          marketListener = listener;
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
      undefined,
      { closePositionPolicy: "always", eventTaskDrainTimeoutMs: 5 },
    );

    try {
      const result = await Promise.race([
        bot.start(2).then(() => "completed" as const),
        Bun.sleep(100).then(() => "timed_out" as const),
      ]);

      expect(result).toBe("completed");
      expect(quoteCount).toBe(2);
      expect(
        logs.messages.some((message) => message.startsWith("bot.event_tasks_drain_timeout")),
      ).toBe(true);
    } finally {
      logs.restore();
    }
  });

  test("logs lifecycle, tick state, and cleanup", async () => {
    const logs = captureLogs();
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: { execute: async () => {} },
        updatePositionOnFill: { execute: async () => {} },
        recordOhlcv: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        closePosition: { execute: async () => {} },
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
