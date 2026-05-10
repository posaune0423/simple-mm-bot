import { describe, expect, test } from "bun:test";

import { binanceCredentials } from "../../scripts/analyzeLeadLagCharts.ts";

describe("binanceCredentials", () => {
  test("does not require BINANCE_API_SECRET when signed credential check is skipped", () => {
    expect(
      binanceCredentials({
        skipCredentialCheck: true,
        env: { BINANCE_API_KEY: " key " },
      }),
    ).toEqual({ apiKey: "key" });
  });

  test("requires BINANCE_API_SECRET when signed credential check is enabled", () => {
    expect(() =>
      binanceCredentials({
        skipCredentialCheck: false,
        env: { BINANCE_API_KEY: "key" },
      }),
    ).toThrow("Missing required environment variable BINANCE_API_SECRET");
  });
});
