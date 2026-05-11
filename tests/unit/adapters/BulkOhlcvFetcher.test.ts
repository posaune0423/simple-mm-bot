import { describe, expect, test } from "bun:test";

import { BulkOhlcvFetcher } from "../../../src/adapters/bulk/BulkOhlcvFetcher.ts";

describe("BulkOhlcvFetcher", () => {
  test("fetches Bulk klines and maps them to OHLCV records", async () => {
    const requests: unknown[] = [];
    const fetcher = new BulkOhlcvFetcher({
      market: {
        async klines(params) {
          requests.push(params);
          return [
            {
              t: 1_700_000_000_000,
              T: 1_700_000_060_000,
              o: 100,
              h: 110,
              l: 95,
              c: 105,
              v: 12.5,
              n: 42,
            },
          ];
        },
      },
    });

    const records = await fetcher.fetch("BTC-USD", "1m", 1_700_000_000_000, 1_700_000_060_000);

    expect(requests).toEqual([
      {
        symbol: "BTC-USD",
        interval: "1m",
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_060_000,
      },
    ]);
    expect(records).toEqual([
      {
        market: "BTC-USD",
        timeframe: "1m",
        ts: 1_700_000_000_000,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 12.5,
      },
    ]);
  });
});
