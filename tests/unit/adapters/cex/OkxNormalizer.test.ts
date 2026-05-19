import { describe, expect, test } from "bun:test";

import { normalizeOkxBbo } from "../../../../src/adapters/cex/okx/OkxNormalizer.ts";

describe("normalizeOkxBbo", () => {
  test("uses asks[0] and bids[0] from bbo-tbt payload", () => {
    const result = normalizeOkxBbo({
      arg: { instId: "BTC-USDT-SWAP" },
      data: [
        {
          bids: [["99999.1", "2.5"]],
          asks: [["100000.2", "3.5"]],
          ts: "1700000000001",
          seqId: 42,
        },
      ],
    });
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      venue: "okx_swap",
      symbol: "BTC-USDT-SWAP",
      bidPrice: 99999.1,
      askPrice: 100000.2,
      exchangeTime: 1_700_000_000_001,
      sequence: "42",
    });
  });

  test("rejects payloads without top bid or ask", () => {
    expect(
      normalizeOkxBbo({
        arg: { instId: "BTC-USDT-SWAP" },
        data: [{ bids: [], asks: [] }],
      }).isErr(),
    ).toBe(true);
  });
});
