import { describe, expect, test } from "bun:test";

import { ExternalMarketFairValueCalculator } from "../../../../src/domain/services/ExternalMarketFairValueCalculator.ts";
import type { ExternalTopOfBook } from "../../../../src/domain/external-market/ExternalMarketTypes.ts";

const sources = [
  { venue: "binance_usdm", symbol: "BTCUSDT", weight: 0.5 },
  { venue: "okx_swap", symbol: "BTC-USDT-SWAP", weight: 0.3 },
  { venue: "bybit_linear", symbol: "BTCUSDT", weight: 0.2 },
] as const;

describe("ExternalMarketFairValueCalculator", () => {
  test("returns weighted fair bid, ask, and mid when all configured sources are usable", () => {
    const calculator = createCalculator();
    const nowMs = 10_000;

    const snapshot = calculator.compute(
      [
        top({ venue: "binance_usdm", symbol: "BTCUSDT", bidPrice: 99, askPrice: 101 }),
        top({ venue: "okx_swap", symbol: "BTC-USDT-SWAP", bidPrice: 100, askPrice: 102 }),
        top({ venue: "bybit_linear", symbol: "BTCUSDT", bidPrice: 98, askPrice: 100 }),
      ],
      nowMs,
    );

    expect(snapshot.status).toBe("ready");
    expect(snapshot.fairBid).toBeCloseTo(99 * 0.5 + 100 * 0.3 + 98 * 0.2);
    expect(snapshot.fairAsk).toBeCloseTo(101 * 0.5 + 102 * 0.3 + 100 * 0.2);
    expect(snapshot.fairMid).toBeCloseTo(100 * 0.5 + 101 * 0.3 + 99 * 0.2);
    expect(snapshot.used.map((source) => source.venue)).toEqual([
      "binance_usdm",
      "okx_swap",
      "bybit_linear",
    ]);
    expect(snapshot.excluded).toEqual([]);
  });

  test("excludes missing and stale sources while keeping degraded fair value usable", () => {
    const calculator = createCalculator();

    const snapshot = calculator.compute(
      [
        top({ venue: "binance_usdm", symbol: "BTCUSDT", bidPrice: 99, askPrice: 101 }),
        top({
          venue: "okx_swap",
          symbol: "BTC-USDT-SWAP",
          bidPrice: 100,
          askPrice: 102,
          receivedAt: 9_000,
        }),
        undefined,
      ],
      10_000,
    );

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.used.map((source) => source.venue)).toEqual(["binance_usdm"]);
    expect(snapshot.excluded).toEqual([
      { venue: "okx_swap", symbol: "BTC-USDT-SWAP", reason: "stale" },
      { venue: "bybit_linear", symbol: "BTCUSDT", reason: "missing" },
    ]);
  });

  test("returns unavailable when filtered sources are below minSourceCount", () => {
    const calculator = createCalculator({ minSourceCount: 2 });

    const snapshot = calculator.compute(
      [
        top({ venue: "binance_usdm", symbol: "BTCUSDT", bidPrice: 99, askPrice: 101 }),
        top({
          venue: "okx_swap",
          symbol: "BTC-USDT-SWAP",
          bidPrice: 100,
          askPrice: 102,
          receivedAt: 9_000,
        }),
        undefined,
      ],
      10_000,
    );

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.fairMid).toBeUndefined();
    expect(snapshot.used).toEqual([]);
  });

  test("excludes invalid and wide-spread books with reasons", () => {
    const calculator = createCalculator({ maxSpreadBps: 15, maxDeviationBps: 20 });

    const snapshot = calculator.compute(
      [
        top({ venue: "binance_usdm", symbol: "BTCUSDT", bidPrice: 101, askPrice: 100 }),
        top({ venue: "okx_swap", symbol: "BTC-USDT-SWAP", bidPrice: 99, askPrice: 101 }),
        top({ venue: "bybit_linear", symbol: "BTCUSDT", bidPrice: 99.95, askPrice: 100.05 }),
      ],
      10_000,
    );

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.excluded).toEqual([
      { venue: "binance_usdm", symbol: "BTCUSDT", reason: "invalid_bbo" },
      { venue: "okx_swap", symbol: "BTC-USDT-SWAP", reason: "wide_spread" },
    ]);
  });

  test("excludes median-deviating outliers with reason=outlier", () => {
    const calculator = createCalculator({ maxSpreadBps: 15, maxDeviationBps: 20 });

    const snapshot = calculator.compute(
      [
        top({ venue: "binance_usdm", symbol: "BTCUSDT", bidPrice: 99.95, askPrice: 100.05 }),
        top({ venue: "okx_swap", symbol: "BTC-USDT-SWAP", bidPrice: 100, askPrice: 100.1 }),
        top({ venue: "bybit_linear", symbol: "BTCUSDT", bidPrice: 119.95, askPrice: 120.05 }),
      ],
      10_000,
    );

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.excluded).toEqual([
      { venue: "bybit_linear", symbol: "BTCUSDT", reason: "outlier" },
    ]);
  });

  test("excludes sources with invalid configured weights", () => {
    const calculator = createCalculator({
      sources: [
        { venue: "binance_usdm", symbol: "BTCUSDT", weight: 0 },
        { venue: "okx_swap", symbol: "BTC-USDT-SWAP", weight: 0.5 },
        { venue: "bybit_linear", symbol: "BTCUSDT", weight: Number.NaN },
      ],
    });

    const snapshot = calculator.compute(
      [
        top({ venue: "binance_usdm", symbol: "BTCUSDT", bidPrice: 99, askPrice: 101 }),
        top({ venue: "okx_swap", symbol: "BTC-USDT-SWAP", bidPrice: 101, askPrice: 103 }),
        top({ venue: "bybit_linear", symbol: "BTCUSDT", bidPrice: 103, askPrice: 105 }),
      ],
      10_000,
    );

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.used.map((source) => [source.venue, source.weight])).toEqual([["okx_swap", 1]]);
    expect(snapshot.excluded).toEqual([
      { venue: "binance_usdm", symbol: "BTCUSDT", reason: "invalid_weight" },
      { venue: "bybit_linear", symbol: "BTCUSDT", reason: "invalid_weight" },
    ]);
    expect(snapshot.fairMid).toBe(102);
  });
});

function createCalculator(
  overrides: Partial<ConstructorParameters<typeof ExternalMarketFairValueCalculator>[0]> = {},
): ExternalMarketFairValueCalculator {
  return new ExternalMarketFairValueCalculator({
    sources,
    maxAgeMs: 500,
    minSourceCount: 1,
    maxSpreadBps: 250,
    maxDeviationBps: 500,
    ...overrides,
  });
}

function top(overrides: Partial<ExternalTopOfBook>): ExternalTopOfBook {
  const bidPrice = overrides.bidPrice ?? 99;
  const askPrice = overrides.askPrice ?? 101;
  return {
    venue: overrides.venue ?? "binance_usdm",
    symbol: overrides.symbol ?? "BTCUSDT",
    exchangeTime: overrides.exchangeTime,
    receivedAt: overrides.receivedAt ?? 9_900,
    bidPrice,
    bidSize: overrides.bidSize ?? 1,
    askPrice,
    askSize: overrides.askSize ?? 1,
    midPrice: overrides.midPrice ?? (bidPrice + askPrice) / 2,
    microPrice: overrides.microPrice,
    spreadBps:
      overrides.spreadBps ?? ((askPrice - bidPrice) / ((bidPrice + askPrice) / 2)) * 10_000,
    sequence: overrides.sequence,
    raw: overrides.raw,
  };
}
