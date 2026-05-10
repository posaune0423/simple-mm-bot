import { describe, expect, test } from "bun:test";

import { BulkMarketFeed } from "../../src/adapters/bulk/BulkMarketFeed.ts";
import { logger } from "../../src/utils/logger.ts";

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for condition");
}

function captureLogs() {
  const info = logger.info;
  const debug = logger.debug;
  const messages: string[] = [];
  logger.info = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  logger.debug = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  return {
    messages,
    restore() {
      logger.info = info;
      logger.debug = debug;
    },
  };
}

describe("BulkMarketFeed", () => {
  test("seeds snapshot from ticker and L2 book with ns timestamps normalized to ms", async () => {
    const client = {
      market: {
        async ticker() {
          return { markPrice: 101, lastPrice: 100.5, timestamp: 1_700_000_000_123 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [
              [
                { price: 99, size: 2 },
                { price: 98, size: 4 },
              ],
              [
                { price: 101, size: 1 },
                { price: 102, size: 3 },
              ],
            ],
          };
        },
      },
      account: {
        async fullAccount() {
          throw new Error("should not fetch without account id");
        },
      },
      ws: {
        async subscribe() {
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, { market: "ETH-USD", nlevels: 20 });

    await feed.connect();
    const snapshot = await feed.getSnapshot();

    expect(snapshot).toMatchObject({
      market: "ETH-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100.33333333333333,
      vampPrice: (99 * 1 + 98 * 3 + 101 * 2 + 102 * 4) / (2 + 4 + 1 + 3),
      markPrice: 101,
      timestamp: 1_700_000_000_123,
      tickerUpdatedAt: 1_700_000_000_123,
      candleUpdatedAt: null,
      accountUpdatedAt: null,
      marginRatio: null,
      availableMarginUsd: null,
    });
    expect(snapshot.bookUpdatedAt).toBeGreaterThan(1_000_000_000_000);
    expect(snapshot.orderBookLevels).toEqual([
      { bidPrice: 99, bidSize: 2, askPrice: 101, askSize: 1 },
      { bidPrice: 98, bidSize: 4, askPrice: 102, askSize: 3 },
    ]);
  });

  test("logs HTTP snapshot seed and websocket subscriptions", async () => {
    const logs = captureLogs();
    const client = {
      market: {
        async ticker() {
          return { markPrice: 101, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 2 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          throw new Error("should not fetch without account id");
        },
      },
      ws: {
        async subscribe() {
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    try {
      const feed = new BulkMarketFeed(client, { market: "BTC-USD", nlevels: 20 });

      await feed.connect();

      expect(logs.messages).toContain("bulk_market_feed.connect market=BTC-USD nlevels=20");
      expect(logs.messages).toContain(
        "bulk_market_feed.snapshot_seeded market=BTC-USD bestBid=99 bestAsk=101 markPrice=101 marginRatio=null availableMarginUsd=null",
      );
      expect(logs.messages).toContain(
        "bulk_market_feed.ws_subscribed market=BTC-USD topics=ticker,l2Snapshot,candle",
      );
    } finally {
      logs.restore();
    }
  });

  test("updates snapshot from websocket ticker and L2 snapshot messages", async () => {
    const handlers: Array<(message: unknown) => void> = [];
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          return {
            margin: { totalBalance: 1000, marginUsed: 250 },
            positions: [{ symbol: "ETH-USD", size: 0.4 }],
          };
        },
      },
      ws: {
        async subscribe(_subscription: unknown, handler: (message: unknown) => void) {
          handlers.push(handler);
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, {
      market: "ETH-USD",
      accountId: "account",
      nlevels: 5,
    });

    await feed.connect();
    handlers[0]?.({ data: { markPrice: 102, timestamp: 1_700_000_001_000 * 1_000_000 } });
    handlers[1]?.({
      data: {
        levels: [
          [
            { price: 100, size: 3 },
            { price: 99, size: 5 },
          ],
          [
            { price: 104, size: 1 },
            { price: 105, size: 2 },
          ],
        ],
        timestamp: 1_700_000_002_000 * 1_000_000,
      },
    });

    const snapshot = await feed.getSnapshot();
    expect(snapshot.markPrice).toBe(102);
    expect(snapshot.bestBid).toBe(100);
    expect(snapshot.bestAsk).toBe(104);
    expect(snapshot.microPrice).toBe(103);
    expect(snapshot.vampPrice).toBeCloseTo((100 * 1 + 99 * 2 + 104 * 3 + 105 * 5) / 11);
    expect(snapshot.orderBookLevels).toEqual([
      { bidPrice: 100, bidSize: 3, askPrice: 104, askSize: 1 },
      { bidPrice: 99, bidSize: 5, askPrice: 105, askSize: 2 },
    ]);
    expect(snapshot.timestamp).toBe(1_700_000_002_000);
    expect(snapshot.marginRatio).toBe(0.75);
    expect(snapshot.positionQty).toBe(0.4);
    expect(snapshot.accountUpdatedAt).toBeGreaterThan(0);
    expect(snapshot.positionUpdatedAt).toBeGreaterThan(0);
  });

  test("polls account and position state without refreshing market timestamps", async () => {
    const handlers: Array<(message: unknown) => void> = [];
    let accountCalls = 0;
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
            timestamp: 1_700_000_000_000 * 1_000_000,
          };
        },
      },
      account: {
        async fullAccount() {
          accountCalls += 1;
          return {
            margin: { totalBalance: 1000, marginUsed: accountCalls === 1 ? 250 : 100 },
            positions: [{ symbol: "BTC-USD", size: accountCalls === 1 ? 0.1 : -0.2 }],
          };
        },
      },
      ws: {
        async subscribe(_subscription: unknown, handler: (message: unknown) => void) {
          handlers.push(handler);
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, {
      market: "BTC-USD",
      accountId: "account",
      accountPollIntervalMs: 1,
    });

    await feed.connect();
    const initial = await feed.getSnapshot();
    await waitFor(() => accountCalls >= 2);
    const polled = await feed.getSnapshot();
    await feed.disconnect();

    expect(handlers).toHaveLength(3);
    expect(initial.timestamp).toBe(1_700_000_000_000);
    expect(polled.timestamp).toBe(1_700_000_000_000);
    expect(polled.marginRatio).toBe(0.9);
    expect(polled.positionQty).toBe(-0.2);
    expect(polled.accountUpdatedAt).toBeGreaterThan(initial.accountUpdatedAt ?? 0);
    expect(polled.positionUpdatedAt).toBeGreaterThan(initial.positionUpdatedAt ?? 0);
  });

  test("does not start overlapping account polls when the previous poll is still in flight", async () => {
    let accountCalls = 0;
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const pending: Array<() => void> = [];
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
            timestamp: 1_700_000_000_000 * 1_000_000,
          };
        },
      },
      account: {
        async fullAccount() {
          accountCalls += 1;
          concurrentCalls += 1;
          maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
          await new Promise<void>((resolve) => pending.push(resolve));
          concurrentCalls -= 1;
          return {
            margin: { totalBalance: 1000, marginUsed: 250 },
            positions: [{ symbol: "BTC-USD", size: 0.1 }],
          };
        },
      },
      ws: {
        async subscribe() {
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, {
      market: "BTC-USD",
      accountId: "account",
      accountPollIntervalMs: 1,
    });

    const initialConnect = feed.connect();
    await waitFor(() => pending.length === 1);
    pending.shift()?.();
    await initialConnect;
    await waitFor(() => pending.length === 1);
    await Bun.sleep(5);
    pending.shift()?.();
    await waitFor(() => accountCalls >= 2);
    await feed.disconnect();

    expect(maxConcurrentCalls).toBe(1);
    expect(accountCalls).toBe(2);
    while (pending.length > 0) {
      pending.shift()?.();
    }
  });

  test("updates snapshot with real OHLCV data from websocket candles", async () => {
    const handlers: Array<(message: unknown) => void> = [];
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          throw new Error("should not fetch without account id");
        },
      },
      ws: {
        async subscribe(_subscription: unknown, handler: (message: unknown) => void) {
          handlers.push(handler);
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, { market: "BTC-USD", nlevels: 20 });

    await feed.connect();
    handlers[2]?.({
      data: {
        candles: [
          {
            t: 1_700_000_000_000,
            T: 1_700_000_059_999,
            o: 100,
            h: 110,
            l: 95,
            c: 105,
            v: 12.5,
          },
        ],
      },
    });

    const snapshot = await feed.getSnapshot();
    expect(snapshot).toMatchObject({
      market: "BTC-USD",
      markPrice: 105,
      timestamp: 1_700_000_000_000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 12.5,
    });
  });

  test("does not carry candle OHLCV fields into ticker and book snapshots", async () => {
    const handlers: Array<(message: unknown) => void> = [];
    const snapshots: Array<{ timestamp: number; open?: number; volume?: number }> = [];
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          throw new Error("should not fetch without account id");
        },
      },
      ws: {
        async subscribe(_subscription: unknown, handler: (message: unknown) => void) {
          handlers.push(handler);
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, { market: "BTC-USD", nlevels: 20 });
    feed.subscribe((snapshot) => {
      snapshots.push({
        timestamp: snapshot.timestamp,
        open: snapshot.open,
        volume: snapshot.volume,
      });
    });

    await feed.connect();
    handlers[2]?.({
      data: {
        candles: [
          {
            t: 1_700_000_000_000,
            T: 1_700_000_059_999,
            o: 100,
            h: 110,
            l: 95,
            c: 105,
            v: 12.5,
          },
        ],
      },
    });
    handlers[0]?.({ data: { markPrice: 106, timestamp: 1_700_000_010_000 * 1_000_000 } });
    handlers[1]?.({
      data: {
        levels: [[{ price: 104, size: 1 }], [{ price: 108, size: 1 }]],
        timestamp: 1_700_000_020_000 * 1_000_000,
      },
    });

    expect(snapshots.at(-3)).toMatchObject({
      timestamp: 1_700_000_000_000,
      open: 100,
      volume: 12.5,
    });
    expect(snapshots.at(-2)).toEqual({ timestamp: 1_700_000_010_000 });
    expect(snapshots.at(-1)).toEqual({ timestamp: 1_700_000_020_000 });
  });

  test("keeps websocket historical candle batches bounded to the latest candles", async () => {
    const handlers: Array<(message: unknown) => void> = [];
    const snapshots: Array<{ timestamp: number; volume?: number }> = [];
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          throw new Error("should not fetch without account id");
        },
      },
      ws: {
        async subscribe(_subscription: unknown, handler: (message: unknown) => void) {
          handlers.push(handler);
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, {
      market: "BTC-USD",
      nlevels: 20,
    });
    feed.subscribe((snapshot) => {
      if (snapshot.open !== undefined) {
        snapshots.push({ timestamp: snapshot.timestamp, volume: snapshot.volume });
      }
    });

    await feed.connect();
    handlers[2]?.({
      data: {
        candles: Array.from({ length: 25 }, (_, index) => ({
          t: 1_700_000_000_000 + index * 60_000,
          T: 1_700_000_059_999 + index * 60_000,
          o: 100 + index,
          h: 101 + index,
          l: 99 + index,
          c: 100.5 + index,
          v: index,
        })),
      },
    });

    expect(snapshots).toHaveLength(20);
    expect(snapshots[0]).toEqual({ timestamp: 1_700_000_300_000, volume: 5 });
    expect(snapshots.at(-1)).toEqual({ timestamp: 1_700_001_440_000, volume: 24 });
  });

  test("ignores empty websocket L2 snapshots after initial seed", async () => {
    const handlers: Array<(message: unknown) => void> = [];
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          throw new Error("should not fetch without account id");
        },
      },
      ws: {
        async subscribe(_subscription: unknown, handler: (message: unknown) => void) {
          handlers.push(handler);
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, { market: "ETH-USD", nlevels: 20 });

    await feed.connect();
    handlers[1]?.({ data: { levels: [[], []], timestamp: 1_700_000_002_000 * 1_000_000 } });

    const snapshot = await feed.getSnapshot();
    expect(snapshot.bestBid).toBe(99);
    expect(snapshot.bestAsk).toBe(101);
    expect(snapshot.timestamp).toBe(1_700_000_000_000);
  });

  test("fails closed when account margin lookup fails with an account id", async () => {
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          throw new Error("account unavailable");
        },
      },
      ws: {
        async subscribe() {
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, { market: "ETH-USD", accountId: "account" });

    await feed.connect().then(
      () => {
        throw new Error("Expected margin lookup to reject");
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("account unavailable");
      },
    );
  });

  test("retries transient account margin lookup before seeding the snapshot", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const client = {
      market: {
        async ticker() {
          return { markPrice: 100, timestamp: 1_700_000_000_000 * 1_000_000 };
        },
        async l2Book() {
          return {
            levels: [[{ price: 99, size: 1 }], [{ price: 101, size: 1 }]],
          };
        },
      },
      account: {
        async fullAccount() {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("HTTP error 408"), {
              name: "BulkHttpError",
              status: 408,
            });
          }
          return { margin: { totalBalance: 1000, marginUsed: 250 } };
        },
      },
      ws: {
        async subscribe() {
          return { unsubscribe: async () => {} };
        },
        async close() {},
      },
    };
    const feed = new BulkMarketFeed(client, {
      market: "ETH-USD",
      accountId: "account",
      accountRetryAttempts: 2,
      accountRetryDelayMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await feed.connect();

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([7]);
    expect((await feed.getSnapshot()).marginRatio).toBe(0.75);
  });
});
