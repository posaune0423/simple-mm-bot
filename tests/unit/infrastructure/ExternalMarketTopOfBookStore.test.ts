import { describe, expect, test } from "bun:test";

import { ExternalMarketTopOfBookStore } from "../../../src/infrastructure/memory/ExternalMarketTopOfBookStore.ts";

const sources = [
  { venue: "binance_usdm", symbol: "BTCUSDT", weight: 0.5 },
  { venue: "okx_swap", symbol: "BTC-USDT-SWAP", weight: 0.3 },
] as const;

describe("ExternalMarketTopOfBookStore", () => {
  test("stores known sources by fixed configured slot order", () => {
    const store = new ExternalMarketTopOfBookStore(sources);

    const accepted = store.update({
      venue: "okx_swap",
      symbol: "BTC-USDT-SWAP",
      receivedAt: 10,
      bidPrice: 99,
      bidSize: 2,
      askPrice: 101,
      askSize: 3,
      sequence: "42",
    });

    expect(accepted).toBe(true);
    expect(store.getVersion()).toBe(1);
    const latest = store.readLatest();
    expect(latest).toHaveLength(2);
    expect(latest[0]).toBeUndefined();
    expect(latest[1]).toMatchObject({
      venue: "okx_swap",
      symbol: "BTC-USDT-SWAP",
      midPrice: 100,
      spreadBps: 200,
      sequence: "42",
    });
  });

  test("ignores unknown source updates without changing version", () => {
    const store = new ExternalMarketTopOfBookStore(sources);

    const accepted = store.update({
      venue: "bybit_linear",
      symbol: "BTCUSDT",
      receivedAt: 10,
      bidPrice: 99,
      bidSize: 1,
      askPrice: 101,
      askSize: 1,
    });

    expect(accepted).toBe(false);
    expect(store.getVersion()).toBe(0);
    expect(store.readLatest()).toEqual([undefined, undefined]);
  });

  test("rejects invalid or crossed BBO updates", () => {
    const store = new ExternalMarketTopOfBookStore(sources);

    expect(
      store.update({
        venue: "binance_usdm",
        symbol: "BTCUSDT",
        receivedAt: 10,
        bidPrice: 101,
        bidSize: 1,
        askPrice: 100,
        askSize: 1,
      }),
    ).toBe(false);
    expect(
      store.update({
        venue: "binance_usdm",
        symbol: "BTCUSDT",
        receivedAt: 10,
        bidPrice: Number.NaN,
        bidSize: 1,
        askPrice: 100,
        askSize: 1,
      }),
    ).toBe(false);

    expect(store.getVersion()).toBe(0);
    expect(store.readLatest()[0]).toBeUndefined();
  });

  test("keeps only the latest value for each source", () => {
    const store = new ExternalMarketTopOfBookStore(sources);

    store.update({
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      receivedAt: 10,
      bidPrice: 99,
      bidSize: 1,
      askPrice: 101,
      askSize: 1,
    });
    store.update({
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      receivedAt: 11,
      bidPrice: 100,
      bidSize: 1,
      askPrice: 102,
      askSize: 1,
    });

    expect(store.getVersion()).toBe(2);
    expect(store.readLatest()[0]).toMatchObject({
      receivedAt: 11,
      bidPrice: 100,
      askPrice: 102,
      midPrice: 101,
    });
  });

  test("rejects out-of-order updates for an existing source", () => {
    const store = new ExternalMarketTopOfBookStore(sources);

    expect(
      store.update({
        venue: "binance_usdm",
        symbol: "BTCUSDT",
        receivedAt: 11,
        bidPrice: 100,
        bidSize: 1,
        askPrice: 102,
        askSize: 1,
      }),
    ).toBe(true);
    expect(
      store.update({
        venue: "binance_usdm",
        symbol: "BTCUSDT",
        receivedAt: 10,
        bidPrice: 99,
        bidSize: 1,
        askPrice: 101,
        askSize: 1,
      }),
    ).toBe(false);

    expect(store.getVersion()).toBe(1);
    expect(store.readLatest()[0]).toMatchObject({
      receivedAt: 11,
      bidPrice: 100,
      askPrice: 102,
    });
  });
});
