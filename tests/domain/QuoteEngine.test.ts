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

  test("builds configured half-spread ladder using per-level USD sizes", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0,
        kappa: 625,
        kInv: 0,
      }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.5,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "ALO",
        positionSize: 0.02,
        budgetUsd: 800,
        minSpreadBps: 16,
        levels: [
          { halfSpreadBps: 8, sizeUsd: 150 },
          { halfSpreadBps: 30, sizeUsd: 600 },
        ],
      },
    );

    const quote = engine.compute(
      {
        market: "BTC-USD",
        bestBid: 99_990,
        bestAsk: 100_010,
        microPrice: 100_000,
        markPrice: 100_000,
        timestamp: 1,
        marginRatio: 1,
      },
      { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
    );

    expect(quote.policy).toBe("ALO");
    expect(quote.levels).toEqual([
      {
        level: 0,
        halfSpreadBps: 8,
        bid: 99_920,
        ask: 100_080,
        bidSize: 0.0015,
        askSize: 0.0015,
      },
      {
        level: 1,
        halfSpreadBps: 30,
        bid: 99_700,
        ask: 100_300,
        bidSize: 0.006,
        askSize: 0.006,
      },
    ]);
    expect(quote.bid).toBe(99_920);
    expect(quote.ask).toBe(100_080);
  });

  test("enforces configured minimum spread in basis points for high-priced markets", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0,
        kappa: 8,
        kInv: 0,
      }),
      new FairPriceCalculator(0.5),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.5,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 0.05,
        budgetUsd: 250,
        minSpreadBps: 6,
      },
    );

    const quote = engine.compute(
      {
        market: "BTC-USD",
        bestBid: 81449.75,
        bestAsk: 81450,
        microPrice: 81449.875,
        markPrice: 81449.875,
        timestamp: 1,
        marginRatio: 1,
      },
      { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
    );

    expect(quote.ask - quote.bid).toBeCloseTo(48.869925, 6);
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
