import { describe, expect, test } from "bun:test";

import { normalizeBinanceUsdmBookTicker } from "../../../../src/adapters/cex/binance/BinanceUsdmNormalizer.ts";

describe("normalizeBinanceUsdmBookTicker", () => {
  test("normalizes bookTicker payload into external top-of-book update", () => {
    const result = normalizeBinanceUsdmBookTicker({
      s: "BTCUSDT",
      b: "99999.1",
      B: "2.5",
      a: "100000.2",
      A: "3.5",
      T: 1_700_000_000_001,
      u: 42,
    });
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      bidPrice: 99999.1,
      bidSize: 2.5,
      askPrice: 100000.2,
      askSize: 3.5,
      exchangeTime: 1_700_000_000_001,
      sequence: "42",
    });
  });

  test("rejects malformed or crossed payloads", () => {
    expect(
      normalizeBinanceUsdmBookTicker({ s: "BTCUSDT", b: "2", B: "1", a: "1", A: "1" }).isErr(),
    ).toBe(true);
    expect(normalizeBinanceUsdmBookTicker({ b: "1", B: "1", a: "2", A: "1" }).isErr()).toBe(true);
  });
});
