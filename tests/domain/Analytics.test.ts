import { describe, expect, test } from "bun:test";

import { Analytics } from "../../src/domain/Analytics.ts";

describe("Analytics", () => {
  test("builds pnl, drawdown, sharpe, and adverse selection metrics", () => {
    const analytics = new Analytics();
    const result = analytics.build({
      quotedCount: 4,
      fills: [
        {
          id: "1",
          venue: "paper",
          market: "ETH",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.1,
          tradePnl: 1.5,
          filledAt: 1,
          markPriceAtFill: 100,
          markPrice5s: 99,
          markPrice30s: 101,
        },
        {
          id: "2",
          venue: "paper",
          market: "ETH",
          side: "sell",
          price: 102,
          qty: 1,
          fee: 0.1,
          tradePnl: -0.5,
          filledAt: 2,
          markPriceAtFill: 102,
          markPrice5s: 103,
          markPrice30s: 104,
        },
      ],
    });

    expect(result.metrics.netPnl).toBeCloseTo(0.8);
    expect(result.metrics.fillRate).toBe(0.5);
    expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.fillAnalysis.adverseSelectionCount).toBe(2);
  });
});
