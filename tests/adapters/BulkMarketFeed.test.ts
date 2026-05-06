import { describe, expect, test } from "bun:test";

import { BulkMarketFeed } from "../../src/adapters/bulk/BulkMarketFeed.ts";
import { logger } from "../../src/utils/logger.ts";

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
    const feed = new BulkMarketFeed(client, { market: "ETH-USD", nlevels: 20 });

    await feed.connect();
    const snapshot = await feed.getSnapshot();

    expect(snapshot).toEqual({
      market: "ETH-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100.33333333333333,
      markPrice: 101,
      timestamp: 1_700_000_000_123,
      marginRatio: null,
    });
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
        "bulk_market_feed.snapshot_seeded market=BTC-USD bestBid=99 bestAsk=101 markPrice=101 marginRatio=null",
      );
      expect(logs.messages).toContain(
        "bulk_market_feed.ws_subscribed market=BTC-USD topics=ticker,l2Snapshot",
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
          return { margin: { totalBalance: 1000, marginUsed: 250 } };
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
        levels: [[{ price: 100, size: 3 }], [{ price: 104, size: 1 }]],
        timestamp: 1_700_000_002_000 * 1_000_000,
      },
    });

    const snapshot = await feed.getSnapshot();
    expect(snapshot.markPrice).toBe(102);
    expect(snapshot.bestBid).toBe(100);
    expect(snapshot.bestAsk).toBe(104);
    expect(snapshot.microPrice).toBe(103);
    expect(snapshot.timestamp).toBe(1_700_000_002_000);
    expect(snapshot.marginRatio).toBe(0.75);
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
});
