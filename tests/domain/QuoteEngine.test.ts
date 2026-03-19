import { describe, expect, test } from "bun:test";

import { FairPriceCalculator } from "../../src/domain/FairPriceCalculator.ts";
import { QuoteEngine } from "../../src/domain/QuoteEngine.ts";
import { VolatilityEstimator } from "../../src/domain/VolatilityEstimator.ts";
import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";

describe("QuoteEngine", () => {
  test("skews quotes lower on the bid side when inventory is long", () => {
    const strategy = new AvellanedaStoikovStrategy({
      gamma: 0.02,
      kappa: 1.5,
      kInv: 0.3,
      baseSize: 0.01,
    });
    const createEngine = () =>
      new QuoteEngine(strategy, new FairPriceCalculator(0.6), new VolatilityEstimator(), {
        inventoryScale: 0.05,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
      });
    const snapshot = {
      market: "ETH",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100,
      markPrice: 100,
      timestamp: Date.now(),
      marginRatio: 0.2,
    };
    const flatEngine = createEngine();
    const longEngine = createEngine();
    const warmupSnapshot = {
      ...snapshot,
      markPrice: 101,
      microPrice: 101,
      bestBid: 100,
      bestAsk: 102,
    };
    flatEngine.compute(warmupSnapshot, { qty: 0, avgEntry: 0, unrealizedPnl: 0 });
    longEngine.compute(warmupSnapshot, { qty: 0.2, avgEntry: 100, unrealizedPnl: 0 });

    const flat = flatEngine.compute(snapshot, { qty: 0, avgEntry: 0, unrealizedPnl: 0 });
    const long = longEngine.compute(snapshot, { qty: 0.2, avgEntry: 100, unrealizedPnl: 0 });

    expect(long.bid).toBeLessThan(flat.bid);
    expect(long.ask).toBeLessThan(flat.ask);
  });

  test("widens spread after volatility increases", () => {
    const strategy = new AvellanedaStoikovStrategy({
      gamma: 0.02,
      kappa: 1.5,
      kInv: 0.3,
      baseSize: 0.01,
    });
    const engine = new QuoteEngine(
      strategy,
      new FairPriceCalculator(0.6),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.05,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
      },
    );

    const base = engine.compute(
      {
        market: "ETH",
        bestBid: 99,
        bestAsk: 101,
        microPrice: 100,
        markPrice: 100,
        timestamp: 1,
        marginRatio: 0.2,
      },
      { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
    );
    const volatile = engine.compute(
      {
        market: "ETH",
        bestBid: 119,
        bestAsk: 121,
        microPrice: 120,
        markPrice: 120,
        timestamp: 2,
        marginRatio: 0.2,
      },
      { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
    );

    expect(volatile.ask - volatile.bid).toBeGreaterThan(base.ask - base.bid);
  });
});
