import { describe, expect, test } from "bun:test";

import { HyperliquidMarketFeed } from "../../../src/adapters/hyperliquid/HyperliquidMarketFeed.ts";
import type { HyperliquidInfoApi } from "../../../src/lib/hyperliquid/HyperliquidInfoApi.ts";
import type { HyperliquidSubscriptionApi } from "../../../src/lib/hyperliquid/HyperliquidSubscriptionApi.ts";

function book(time: number) {
  return {
    coin: "BTC",
    time,
    bids: [{ price: 99, size: 1 }],
    asks: [{ price: 101, size: 1 }],
  };
}

describe("HyperliquidMarketFeed", () => {
  test("refreshes account and position timestamps on each valid margin poll", async () => {
    let bookTime = 1_700_000_000_000;
    let marginCalls = 0;
    const info = {
      async getL2Book() {
        bookTime += 1;
        return book(bookTime);
      },
      async getAllMids() {
        return { BTC: 100 };
      },
      async getClearinghouseState() {
        marginCalls += 1;
        return { accountValue: 1000, totalMarginUsed: marginCalls === 1 ? 200 : 100 };
      },
    } as unknown as HyperliquidInfoApi;
    const subs = {
      async subscribeL2Book() {
        return async () => {};
      },
      async subscribeAllMids() {
        return async () => {};
      },
    } as unknown as HyperliquidSubscriptionApi;
    const feed = new HyperliquidMarketFeed(info, subs, {
      market: "BTC",
      accountAddress: "0xabc",
      pollIntervalMs: 1,
    });

    await feed.connect();
    const initial = await feed.getSnapshot();
    await waitFor(() => marginCalls >= 2);
    const polled = await feed.getSnapshot();
    await feed.disconnect();

    expect(initial.marginRatio).toBe(0.8);
    expect(polled.marginRatio).toBe(0.9);
    expect(polled.accountUpdatedAt).toBeGreaterThan(initial.accountUpdatedAt ?? 0);
    expect(polled.positionUpdatedAt).toBeGreaterThan(initial.positionUpdatedAt ?? 0);
  });

  test("keeps previous account freshness timestamp when margin polling fails", async () => {
    let marginCalls = 0;
    const info = {
      async getL2Book() {
        return book(1_700_000_000_000 + marginCalls);
      },
      async getAllMids() {
        return { BTC: 100 };
      },
      async getClearinghouseState() {
        marginCalls += 1;
        if (marginCalls > 1) {
          throw new Error("margin unavailable");
        }
        return { accountValue: 1000, totalMarginUsed: 200 };
      },
    } as unknown as HyperliquidInfoApi;
    const subs = {
      async subscribeL2Book() {
        return async () => {};
      },
      async subscribeAllMids() {
        return async () => {};
      },
    } as unknown as HyperliquidSubscriptionApi;
    const feed = new HyperliquidMarketFeed(info, subs, {
      market: "BTC",
      accountAddress: "0xabc",
      pollIntervalMs: 1,
    });

    await feed.connect();
    const initial = await feed.getSnapshot();
    await waitFor(() => marginCalls >= 2);
    const polled = await feed.getSnapshot();
    await feed.disconnect();

    expect(polled.marginRatio).toBeNull();
    expect(polled.accountUpdatedAt).toBe(initial.accountUpdatedAt);
    expect(polled.positionUpdatedAt).toBe(initial.positionUpdatedAt);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for condition");
}
