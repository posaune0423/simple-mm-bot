import type { Fill } from "../../src/domain/entities/Fill.ts";

const HOUR = 60 * 60 * 1000;

const defaultFill: Fill = {
  id: "f1",
  venue: "hyperliquid",
  market: "ETH-USD",
  side: "buy",
  price: 100,
  qty: 1,
  fee: 0.05,
  tradePnl: 0,
  filledAt: Date.UTC(2026, 4, 1, 0, 0, 0),
  markPriceAtFill: 100,
  markPrice5s: 100,
  markPrice30s: 100,
};

export function buildFill(overrides: Partial<Fill> = {}): Fill {
  return { ...defaultFill, ...overrides };
}

export function sampleFills(): Fill[] {
  const start = Date.UTC(2026, 4, 1, 0, 0, 0);
  const fills: Fill[] = [];
  for (let i = 0; i < 12; i += 1) {
    const side = i % 2 === 0 ? "buy" : "sell";
    fills.push(
      buildFill({
        id: `f${i}`,
        side,
        price: 100 + i,
        qty: 1,
        fee: 0.05,
        tradePnl: i % 3 === 0 ? -0.5 : 0.3,
        filledAt: start + i * HOUR,
        markPriceAtFill: 100 + i,
        markPrice5s: 100 + i + (i % 2 === 0 ? 0.1 : -0.2),
        markPrice30s: 100 + i + (i % 2 === 0 ? 0.5 : -0.3),
      }),
    );
  }
  return fills;
}
