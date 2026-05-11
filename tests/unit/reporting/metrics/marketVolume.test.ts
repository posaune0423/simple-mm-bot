import { describe, expect, test } from "bun:test";

import {
  computeFeeVsPnl,
  computeMarketVolume,
} from "../../../../src/lib/reporting/metrics/marketVolume.ts";
import { buildFill } from "../fixtures.ts";

describe("computeMarketVolume", () => {
  test("aggregates notional and fill count per market sorted descending", () => {
    const fills = [
      buildFill({ id: "a", market: "ETH", price: 100, qty: 1 }),
      buildFill({ id: "b", market: "ETH", price: 100, qty: 2 }),
      buildFill({ id: "c", market: "BTC", price: 1000, qty: 0.1 }),
    ];
    expect(computeMarketVolume(fills)).toEqual([
      { market: "ETH", notional: 300, fillCount: 2 },
      { market: "BTC", notional: 100, fillCount: 1 },
    ]);
  });
});

describe("computeFeeVsPnl", () => {
  test("aggregates fee, trade pnl, and net pnl per UTC hour", () => {
    const fills = [
      buildFill({
        id: "a",
        filledAt: Date.UTC(2026, 0, 1, 2, 0, 0),
        fee: 0.1,
        tradePnl: 0.5,
      }),
      buildFill({
        id: "b",
        filledAt: Date.UTC(2026, 0, 1, 2, 10, 0),
        fee: 0.2,
        tradePnl: -0.1,
      }),
    ];
    const result = computeFeeVsPnl(fills);
    const hour2 = result[2];
    expect(hour2?.hour).toBe(2);
    expect(hour2?.fee).toBeCloseTo(0.3);
    expect(hour2?.tradePnl).toBeCloseTo(0.4);
    expect(hour2?.netPnl).toBeCloseTo(0.1);
  });
});
