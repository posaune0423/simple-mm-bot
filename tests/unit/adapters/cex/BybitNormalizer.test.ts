import { describe, expect, test } from "bun:test";

import { normalizeBybitOrderbook1 } from "../../../../src/adapters/cex/bybit/BybitNormalizer.ts";

describe("normalizeBybitOrderbook1", () => {
  test("uses data.b[0] and data.a[0] from orderbook.1 payload", () => {
    const update = normalizeBybitOrderbook1({
      topic: "orderbook.1.BTCUSDT",
      ts: 1_700_000_000_000,
      data: {
        s: "BTCUSDT",
        b: [["99999.1", "2.5"]],
        a: [["100000.2", "3.5"]],
        cts: 1_700_000_000_001,
        seq: 42,
      },
    });

    expect(update).toMatchObject({
      venue: "bybit_linear",
      symbol: "BTCUSDT",
      bidPrice: 99999.1,
      askPrice: 100000.2,
      exchangeTime: 1_700_000_000_001,
      sequence: "42",
    });
  });

  test("rejects empty bid or ask arrays", () => {
    expect(
      normalizeBybitOrderbook1({ topic: "orderbook.1.BTCUSDT", data: { b: [], a: [] } }),
    ).toBeNull();
  });
});
