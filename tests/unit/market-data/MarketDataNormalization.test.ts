import { describe, expect, test } from "bun:test";

import {
  normalizeBulkBookSnapshot,
  normalizeBulkTicker,
  normalizeBulkTrades,
} from "../../../src/adapters/bulk/marketDataNormalization.ts";

describe("Bulk market data normalization", () => {
  test("calculates mid, micro, and spread for a valid order book", () => {
    const snapshot = normalizeBulkBookSnapshot({
      venue: "bulk",
      symbol: "BTC-USD",
      depth: 2,
      receivedAt: 1_700_000_000_000,
      book: {
        timestamp: 1_700_000_000_000_000_000,
        levels: [
          [
            { px: 99, sz: 2 },
            { px: 98, sz: 3 },
          ],
          [
            { px: 101, sz: 1 },
            { px: 102, sz: 4 },
          ],
        ],
      },
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        venue: "bulk",
        symbol: "BTC-USD",
        exchangeTime: 1_700_000_000_000,
        receivedAt: 1_700_000_000_000,
        depth: 2,
        bestBidPrice: 99,
        bestBidSize: 2,
        bestAskPrice: 101,
        bestAskSize: 1,
        midPrice: 100,
        microPrice: 100.33333333333333,
        spreadBps: 200,
        bids: [
          { price: 99, quantity: 2 },
          { price: 98, quantity: 3 },
        ],
        asks: [
          { price: 101, quantity: 1 },
          { price: 102, quantity: 4 },
        ],
      }),
    );
    expect(snapshot?.id).toContain("bulk:BTC-USD:book:1700000000000");
  });

  test("rejects empty books", () => {
    const snapshot = normalizeBulkBookSnapshot({
      venue: "bulk",
      symbol: "BTC-USD",
      depth: 10,
      receivedAt: 1,
      book: { levels: [[], []] },
    });

    expect(snapshot).toBeNull();
  });

  test("rejects crossed books", () => {
    const snapshot = normalizeBulkBookSnapshot({
      venue: "bulk",
      symbol: "BTC-USD",
      depth: 10,
      receivedAt: 1,
      book: { levels: [[{ px: 101, sz: 1 }], [{ px: 100, sz: 1 }]] },
    });

    expect(snapshot).toBeNull();
  });

  test("rejects invalid price or size", () => {
    const snapshot = normalizeBulkBookSnapshot({
      venue: "bulk",
      symbol: "BTC-USD",
      depth: 10,
      receivedAt: 1,
      book: { levels: [[{ px: Number.NaN, sz: 1 }], [{ px: 100, sz: 1 }]] },
    });

    expect(snapshot).toBeNull();
  });

  test("normalizes ticker payloads", () => {
    const ticker = normalizeBulkTicker({
      venue: "bulk",
      symbol: "BTC-USD",
      receivedAt: 1_700_000_000_000,
      ticker: {
        timestamp: 1_700_000_000_000_000_000,
        markPrice: 101,
        oraclePrice: 100,
        lastPrice: 102,
        fundingRate: 0.0001,
        openInterest: 123,
      },
    });

    expect(ticker).toEqual(
      expect.objectContaining({
        venue: "bulk",
        symbol: "BTC-USD",
        exchangeTime: 1_700_000_000_000,
        receivedAt: 1_700_000_000_000,
        markPrice: 101,
        indexPrice: 100,
        lastPrice: 102,
        fundingRate: 0.0001,
        openInterest: 123,
      }),
    );
  });

  test("normalizes trade payloads", () => {
    const trades = normalizeBulkTrades({
      venue: "bulk",
      symbol: "BTC-USD",
      receivedAt: 1_700_000_000_000,
      trades: [
        {
          s: "BTC-USD",
          px: 100,
          sz: 0.5,
          time: 1_700_000_000_000,
          side: true,
          maker: "maker",
          taker: "taker",
        },
      ],
    });

    expect(trades).toEqual([
      expect.objectContaining({
        venue: "bulk",
        symbol: "BTC-USD",
        exchangeTime: 1_700_000_000_000,
        receivedAt: 1_700_000_000_000,
        price: 100,
        quantity: 0.5,
        side: "buy",
        aggressorSide: "buy",
      }),
    ]);
  });
});
