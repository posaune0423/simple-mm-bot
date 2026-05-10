import { describe, expect, test } from "bun:test";

import { FairPriceCalculator } from "../../src/domain/FairPriceCalculator.ts";
import { QuoteEngine } from "../../src/domain/QuoteEngine.ts";
import { VolatilityEstimator } from "../../src/domain/VolatilityEstimator.ts";
import type { Quote, QuoteContext } from "../../src/domain/entities/Quote.ts";
import type { IQuotingStrategy } from "../../src/domain/strategy/IQuotingStrategy.ts";
import { AvellanedaStoikovStrategy } from "../../src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";

class FixedMultiplierStrategy implements IQuotingStrategy {
  readonly name = "fixed-multiplier";

  computeQuote(context: QuoteContext): Quote {
    return {
      bid: context.fairPrice - 10,
      ask: context.fairPrice + 10,
      bidSize: context.quoteSize * 0.25,
      askSize: context.quoteSize * 1.8,
      bidSizeMultiplier: 0.25,
      askSizeMultiplier: 1.8,
      policy: context.defaultTimeInForce,
      fairPrice: context.fairPrice,
      sigma: context.sigma,
    };
  }
}

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
        bidIntent: "open_quote",
        askIntent: "open_quote",
      },
      {
        level: 1,
        halfSpreadBps: 30,
        bid: 99_700,
        ask: 100_300,
        bidSize: 0.006,
        askSize: 0.006,
        bidIntent: "open_quote",
        askIntent: "open_quote",
      },
    ]);
    expect(quote.bid).toBe(99_920);
    expect(quote.ask).toBe(100_080);
  });

  test("keeps Avellaneda-Stoikov single quote when levels are not configured", () => {
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

    expect(quote.levels).toBeUndefined();
    expect(quote.bidSize).toBe(0.008);
    expect(quote.askSize).toBe(0.008);
  });

  test("quote controls disable only open quote side while preserving reduce side", () => {
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
        defaultTimeInForce: "GTC",
        positionSize: 0.02,
        budgetUsd: 2_000,
        levels: [{ halfSpreadBps: 3, sizeUsd: 1_000 }],
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
      { qty: 0.01, avgEntry: 100_000, unrealizedPnl: 0 },
      {
        ask: {
          disableOpen: true,
          reasonTags: ["quality_gate:sell:30s"],
        },
      },
    );

    expect(quote.levels?.[0]?.bidIntent).toBe("open_quote");
    expect(quote.levels?.[0]?.askIntent).toBe("reduce_inventory");
    expect(quote.levels?.[0]?.askSize).toBe(0.01);
    expect(quote.askControlReasons).toEqual(["quality_gate:sell:30s"]);
  });

  test("applies strategy side size multipliers to configured ladder levels", () => {
    const engine = new QuoteEngine(
      new FixedMultiplierStrategy(),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.5,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 0.02,
        budgetUsd: 2_000,
        levels: [{ halfSpreadBps: 3, sizeUsd: 1_000 }],
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

    expect(quote.bidSize).toBe(0.0025);
    expect(quote.askSize).toBeCloseTo(0.018);
    expect(quote.levels?.[0]?.bidSize).toBe(0.0025);
    expect(quote.levels?.[0]?.askSize).toBeCloseTo(0.018);
  });

  test("caps combined open ladder notional by live available margin and leverage", () => {
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
        defaultTimeInForce: "GTC",
        positionSize: 4,
        budgetUsd: 500_000,
        maxLeverage: 50,
        levels: [
          { halfSpreadBps: 2, sizeUsd: 250_000 },
          { halfSpreadBps: 4, sizeUsd: 250_000 },
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
        availableMarginUsd: 8_959,
      },
      { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
    );

    const totalBidNotional =
      (quote.levels?.reduce((sum, level) => sum + level.bidSize, 0) ?? 0) * quote.fairPrice;
    const totalAskNotional =
      (quote.levels?.reduce((sum, level) => sum + level.askSize, 0) ?? 0) * quote.fairPrice;
    const expectedCombinedCap = 8_959 * 50 * 0.95;
    expect(totalBidNotional + totalAskNotional).toBeCloseTo(expectedCombinedCap);
    expect(totalBidNotional).toBeCloseTo(expectedCombinedCap / 2);
    expect(totalAskNotional).toBeCloseTo(expectedCombinedCap / 2);
  });

  test("reserves current inventory exposure before capping open ladder notional", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0,
        kappa: 625,
        kInv: 0,
      }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 1_000,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 4,
        budgetUsd: 500_000,
        maxLeverage: 50,
        levels: [
          { halfSpreadBps: 2, sizeUsd: 250_000 },
          { halfSpreadBps: 4, sizeUsd: 250_000 },
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
        availableMarginUsd: 8_959,
      },
      { qty: 0.9, avgEntry: 100_000, unrealizedPnl: 0 },
    );

    const totalOpenBidNotional =
      (quote.levels?.reduce(
        (sum, level) => sum + (level.bidIntent === "open_quote" ? level.bidSize : 0),
        0,
      ) ?? 0) * quote.fairPrice;
    const totalReduceAskQty =
      quote.levels?.reduce(
        (sum, level) => sum + (level.askIntent === "reduce_inventory" ? level.askSize : 0),
        0,
      ) ?? 0;
    const maxGrossExposureNotional = 8_959 * 50 * 0.95;
    const reservedInventoryNotional = 0.9 * quote.fairPrice;
    expect(totalOpenBidNotional).toBeCloseTo(maxGrossExposureNotional - reservedInventoryNotional);
    expect(totalReduceAskQty).toBeCloseTo(0.9);
  });

  test("disables open ladder quotes when live available margin is exhausted", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0,
        kappa: 625,
        kInv: 0,
      }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 1_000,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 4,
        budgetUsd: 500_000,
        maxLeverage: 50,
        levels: [
          { halfSpreadBps: 2, sizeUsd: 250_000 },
          { halfSpreadBps: 4, sizeUsd: 250_000 },
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
        marginRatio: 0,
        availableMarginUsd: 0,
      },
      { qty: 0.9, avgEntry: 100_000, unrealizedPnl: 0 },
    );

    expect(quote.levels?.map((level) => level.bidIntent)).toEqual(["disabled", "disabled"]);
    expect(quote.levels?.map((level) => level.bidSize)).toEqual([0, 0]);
    expect(quote.levels?.map((level) => level.askIntent)).toEqual(["reduce_inventory", "disabled"]);
    const totalReduceAskQty =
      quote.levels?.reduce(
        (sum, level) => sum + (level.askIntent === "reduce_inventory" ? level.askSize : 0),
        0,
      ) ?? 0;
    expect(totalReduceAskQty).toBeCloseTo(0.9);
  });

  test("applies configured side size multipliers after ladder sizing", () => {
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
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 40_000,
        bidSizeMultiplier: 0.25,
        askSizeMultiplier: 1.5,
        levels: [
          { halfSpreadBps: 2, sizeUsd: 10_000 },
          { halfSpreadBps: 4, sizeUsd: 10_000 },
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

    expect(quote.bidSize).toBeCloseTo(0.025);
    expect(quote.askSize).toBeCloseTo(0.15);
    expect(quote.levels).toHaveLength(2);
    for (const level of quote.levels ?? []) {
      expect(level.bidSize).toBeCloseTo(0.025);
      expect(level.askSize).toBeCloseTo(0.15);
    }
  });

  test("caps side-multiplied ladder notional by the configured budget", () => {
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
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 20_000,
        bidSizeMultiplier: 1.2,
        askSizeMultiplier: 1.5,
        levels: [
          { halfSpreadBps: 2, sizeUsd: 10_000 },
          { halfSpreadBps: 4, sizeUsd: 10_000 },
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

    const totalBidQty = quote.levels?.reduce((sum, level) => sum + level.bidSize, 0) ?? 0;
    const totalAskQty = quote.levels?.reduce((sum, level) => sum + level.askSize, 0) ?? 0;
    expect(totalBidQty).toBeCloseTo(0.2);
    expect(totalAskQty).toBeCloseTo(0.2);
    expect(quote.levels?.map((level) => level.bidSize)).toEqual([0.1, 0.1]);
    expect(quote.levels?.map((level) => level.askSize)).toEqual([0.1, 0.1]);
  });

  test("applies configured side distance multipliers after ladder pricing", () => {
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
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 20_000,
        bidDistanceMultiplier: 1.5,
        askDistanceMultiplier: 1,
        levels: [
          { halfSpreadBps: 2, sizeUsd: 10_000 },
          { halfSpreadBps: 4, sizeUsd: 10_000 },
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

    expect(quote.bid).toBeCloseTo(99_970);
    expect(quote.ask).toBeCloseTo(100_020);
    expect(quote.levels?.[0]?.bid).toBeCloseTo(99_970);
    expect(quote.levels?.[0]?.ask).toBeCloseTo(100_020);
    expect(quote.levels?.[1]?.bid).toBeCloseTo(99_940);
    expect(quote.levels?.[1]?.ask).toBeCloseTo(100_040);
  });

  test("caps side-multiplied reduce quantities to the current inventory", () => {
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
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 20_000,
        bidSizeMultiplier: 2,
        askSizeMultiplier: 1,
        levels: [
          { halfSpreadBps: 2, sizeUsd: 10_000 },
          { halfSpreadBps: 4, sizeUsd: 10_000 },
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
      { qty: -0.12, avgEntry: 100_000, unrealizedPnl: 0 },
    );

    const totalBidQty =
      quote.levels?.reduce((sum, level) => sum + level.bidSize, 0) ?? quote.bidSize;
    expect(totalBidQty).toBeCloseTo(0.12);
    expect(quote.bidIntent).toBe("reduce_inventory");
  });

  test("lets ladder bid size fade near zero when long inventory is saturated", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0,
        kappa: 625,
        kInv: 0,
      }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.2,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 1_000,
        minSpreadBps: 6,
        levels: [{ halfSpreadBps: 3, sizeUsd: 1_000 }],
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
      { qty: 0.6, avgEntry: 100_000, unrealizedPnl: 0 },
    );

    expect(quote.bidSize).toBeLessThan(0.001);
    expect(quote.askSize).toBeGreaterThan(0.017);
  });

  test("does not pin underwater long inventory exits to the average entry", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0,
        kappa: 625,
        kInv: 0,
      }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.2,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 1_000,
        minSpreadBps: 5,
        levels: [{ halfSpreadBps: 2.5, sizeUsd: 1_000 }],
      },
    );

    const quote = engine.compute(
      {
        market: "BTC-USD",
        bestBid: 99_490,
        bestAsk: 99_510,
        microPrice: 99_500,
        markPrice: 99_500,
        timestamp: 1,
        marginRatio: 1,
      },
      { qty: 0.05, avgEntry: 100_000, unrealizedPnl: -25 },
    );

    expect(quote.askIntent).toBe("reduce_inventory");
    expect(quote.ask).toBeLessThan(100_000);
    expect(quote.ask - quote.fairPrice).toBeLessThan(quote.fairPrice - quote.bid);
  });

  test("does not pin underwater short inventory buybacks to the average entry", () => {
    const engine = new QuoteEngine(
      new AvellanedaStoikovStrategy({
        gamma: 0,
        kappa: 625,
        kInv: 0,
      }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.08,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 21_600,
        minSpreadBps: 2.4,
        levels: [
          { halfSpreadBps: 1.2, sizeUsd: 7_200 },
          { halfSpreadBps: 2.4, sizeUsd: 7_200 },
          { halfSpreadBps: 3.6, sizeUsd: 7_200 },
        ],
      },
    );

    const quote = engine.compute(
      {
        market: "BTC-USD",
        bestBid: 80_199.999,
        bestAsk: 80_200,
        microPrice: 80_200,
        markPrice: 80_200,
        timestamp: 1,
        marginRatio: 1,
      },
      { qty: -0.039024, avgEntry: 79_981.548, unrealizedPnl: -8.5 },
    );

    expect(quote.bidIntent).toBe("reduce_inventory");
    expect(quote.bid).toBeGreaterThan(79_981.548);
    expect(quote.fairPrice - quote.bid).toBeLessThan(quote.ask - quote.fairPrice);
    expect(quote.levels?.[0]?.bid).toBeGreaterThan(80_190);
  });

  test("moves short inventory buyback levels closer than flat quotes", () => {
    const config = {
      inventoryScale: 0.2,
      timeHorizonSec: 10,
      slideMarginThreshold: 0.08,
      defaultTimeInForce: "GTC" as const,
      positionSize: 1,
      budgetUsd: 1_000,
      minSpreadBps: 6,
      levels: [{ halfSpreadBps: 3, sizeUsd: 1_000 }],
    };
    const snapshot = {
      market: "BTC-USD",
      bestBid: 99_990,
      bestAsk: 100_010,
      microPrice: 100_000,
      markPrice: 100_000,
      timestamp: 1,
      marginRatio: 1,
    };
    const flat = new QuoteEngine(
      new AvellanedaStoikovStrategy({ gamma: 0, kappa: 625, kInv: 0 }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      config,
    ).compute(snapshot, { qty: 0, avgEntry: 0, unrealizedPnl: 0 });
    const short = new QuoteEngine(
      new AvellanedaStoikovStrategy({ gamma: 0, kappa: 625, kInv: 0 }),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      config,
    ).compute(snapshot, { qty: -0.12, avgEntry: 100_100, unrealizedPnl: 12 });

    expect(short.fairPrice - short.bid).toBeLessThan(flat.fairPrice - flat.bid);
    expect(short.ask - short.fairPrice).toBeGreaterThan(flat.ask - flat.fairPrice);
  });

  test("marks short inventory bids as reduce-only intent and caps buyback size", () => {
    const engine = new QuoteEngine(
      new FixedMultiplierStrategy(),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.2,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 20_000,
        levels: [
          { halfSpreadBps: 3, sizeUsd: 100_000 },
          { halfSpreadBps: 4, sizeUsd: 100_000 },
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
      { qty: -0.3, avgEntry: 100_100, unrealizedPnl: 12 },
    );

    expect(quote.bidIntent).toBe("reduce_inventory");
    expect(quote.askIntent).toBe("open_quote");
    expect(quote.levels?.map((level) => level.bidIntent)).toEqual(["reduce_inventory", "disabled"]);
    const totalBidQty =
      quote.levels?.reduce((sum, level) => sum + level.bidSize, 0) ?? quote.bidSize;
    expect(totalBidQty).toBeCloseTo(0.3);
  });

  test("treats floating-point residual inventory as flat when assigning side intents", () => {
    const engine = new QuoteEngine(
      new FixedMultiplierStrategy(),
      new FairPriceCalculator(1),
      new VolatilityEstimator(),
      {
        inventoryScale: 0.2,
        timeHorizonSec: 10,
        slideMarginThreshold: 0.08,
        defaultTimeInForce: "GTC",
        positionSize: 1,
        budgetUsd: 20_000,
        levels: [{ halfSpreadBps: 3, sizeUsd: 1_000 }],
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
      { qty: 1.3877787807814457e-17, avgEntry: 100_000, unrealizedPnl: 0 },
    );

    expect(quote.bidIntent).toBe("open_quote");
    expect(quote.askIntent).toBe("open_quote");
    expect(quote.bidSize).toBeCloseTo(0.0025);
    expect(quote.askSize).toBeCloseTo(0.018);
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
