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
    });
    const createEngine = () =>
      new QuoteEngine(strategy, new FairPriceCalculator(0.6), new VolatilityEstimator(), {
        inventoryScale: 0.05,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
        defaultTimeInForce: "ALO",
        positionSize: 0.01,
        budgetUsd: 100,
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
    });
    const engine = new QuoteEngine(
      strategy,
      new FairPriceCalculator(0.6),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.05,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
        defaultTimeInForce: "ALO",
        positionSize: 0.01,
        budgetUsd: 100,
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

  test("caps quote size by configured budget", () => {
    const strategy = new AvellanedaStoikovStrategy({
      gamma: 0.02,
      kappa: 1.5,
      kInv: 0.3,
    });
    const engine = new QuoteEngine(
      strategy,
      new FairPriceCalculator(0.6),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.05,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
        defaultTimeInForce: "ALO",
        positionSize: 0.1,
        budgetUsd: 10,
      },
    );

    const quote = engine.compute(
      {
        market: "ETH",
        bestBid: 249,
        bestAsk: 251,
        microPrice: 250,
        markPrice: 250,
        timestamp: 1,
        marginRatio: 0.2,
      },
      { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
    );

    expect(quote.bidSize).toBe(0.04);
    expect(quote.askSize).toBe(0.04);
  });

  test("uses configured default time in force for normal quote policy", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0.02,
        kappa: 1.5,
        kInv: 0.3,
      }),
      new FairPriceCalculator(0.6),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.05,
        timeHorizonSec: 30,
        slideMarginThreshold: 0.12,
        defaultTimeInForce: "GTC",
        positionSize: 0.01,
      },
    );

    const quote = engine.compute(
      {
        market: "ETH-USD",
        bestBid: 99,
        bestAsk: 101,
        microPrice: 100,
        markPrice: 100,
        timestamp: 1,
        marginRatio: 0.2,
      },
      { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
    );

    expect(quote.policy).toBe("GTC");
  });
});
