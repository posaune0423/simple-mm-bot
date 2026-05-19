import { describe, expect, test } from "bun:test";

import { parseExternalMarketRealtimeArgs } from "../../../src/application/services/ExternalMarketRealtimeArgs.ts";

describe("parseExternalMarketRealtimeArgs", () => {
  test("keeps log mode finite by default for verification runs", () => {
    expect(parseExternalMarketRealtimeArgs(["bun", "script"], { isTty: false })).toEqual({
      durationMs: 30_000,
      refreshMs: 1_000,
      statsWindowMs: 5_000,
      viewMode: "log",
      watch: false,
    });
  });

  test("keeps tui mode running until interrupted when duration is omitted", () => {
    expect(
      parseExternalMarketRealtimeArgs(["bun", "script", "--view", "tui"], { isTty: true }),
    ).toEqual({
      durationMs: undefined,
      refreshMs: 1_000,
      statsWindowMs: 5_000,
      viewMode: "tui",
      watch: true,
    });
  });

  test("supports explicit watch mode and zero duration", () => {
    expect(
      parseExternalMarketRealtimeArgs(["bun", "script", "--watch"], { isTty: false }).watch,
    ).toBe(true);
    expect(
      parseExternalMarketRealtimeArgs(["bun", "script", "--durationMs", "0"], { isTty: false })
        .durationMs,
    ).toBeUndefined();
  });
});
