import type { Position } from "./entities/Position.ts";
import { isFlatPositionQty } from "./entities/Position.ts";
import type { OrderTimeInForce, Quote, QuoteLevel, QuoteSideIntent } from "./entities/Quote.ts";
import type { MarketSnapshot } from "./ports/IMarketFeed.ts";
import type { IQuotingStrategy } from "./strategy/IQuotingStrategy.ts";
import type { FairPriceCalculator } from "./FairPriceCalculator.ts";
import type { VolatilityEstimator } from "./VolatilityEstimator.ts";

interface QuoteEngineConfig {
  inventoryScale: number;
  timeHorizonSec: number;
  minSpreadBps?: number;
  slideMarginThreshold: number;
  defaultTimeInForce: OrderTimeInForce;
  positionSize: number;
  budgetUsd?: number;
  levels?: ReadonlyArray<QuoteLadderLevelConfig>;
}

interface QuoteLadderLevelConfig {
  halfSpreadBps: number;
  sizeUsd: number;
}

export class QuoteEngine {
  constructor(
    private readonly strategy: IQuotingStrategy,
    private readonly fairCalc: FairPriceCalculator,
    private readonly volEst: VolatilityEstimator,
    private readonly config: QuoteEngineConfig,
  ) {}

  compute(snapshot: MarketSnapshot, position: Position): Quote {
    // The quote engine is the composition point:
    // 1. derive a fair price from market signals
    // 2. update short-horizon volatility
    // 3. let the strategy convert state into executable bid/ask levels
    const fairPrice = this.fairCalc.compute(snapshot);
    const sigma = this.volEst.update(snapshot.markPrice);
    const quoteSize = this.computeQuoteSize(fairPrice);
    const quote = this.strategy.computeQuote({
      fairPrice,
      sigma,
      quoteSize,
      positionQty: position.qty,
      inventoryScale: this.config.inventoryScale,
      timeHorizonSec: this.config.timeHorizonSec,
      minSpreadBps: this.config.minSpreadBps,
      slideMarginThreshold: this.config.slideMarginThreshold,
      defaultTimeInForce: this.config.defaultTimeInForce,
      marginRatio: snapshot.marginRatio,
    });
    return this.withSideIntentCaps(this.withConfiguredLevels(quote, position), position);
  }

  private computeQuoteSize(fairPrice: number): number {
    if (this.config.budgetUsd === undefined || fairPrice <= 0) {
      return this.config.positionSize;
    }

    return Math.min(this.config.positionSize, this.config.budgetUsd / fairPrice);
  }

  private withConfiguredLevels(quote: Quote, position: Position): Quote {
    if (this.config.levels === undefined) {
      return quote;
    }

    const levels = this.config.levels.map((level, index) =>
      this.configuredLevel(quote, position, level, index),
    );
    const top = levels[0];
    if (top === undefined) {
      return quote;
    }

    return {
      ...quote,
      bid: top.bid,
      ask: top.ask,
      bidSize: top.bidSize,
      askSize: top.askSize,
      levels,
    };
  }

  private configuredLevel(
    quote: Quote,
    position: Position,
    levelConfig: QuoteLadderLevelConfig,
    index: number,
  ): QuoteLevel {
    const reservationPrice = (quote.bid + quote.ask) / 2;
    const minHalfSpreadBps = (this.config.minSpreadBps ?? 0) / 2;
    const halfSpreadBps = Math.max(levelConfig.halfSpreadBps, minHalfSpreadBps);
    const size = levelConfig.sizeUsd / quote.fairPrice;
    const inventoryRatio = Math.tanh(position.qty / this.config.inventoryScale);
    const bidSize = size * clamp(1 - inventoryRatio, 0, 1.75) * (quote.bidSizeMultiplier ?? 1);
    const askSize = size * clamp(1 + inventoryRatio, 0, 1.75) * (quote.askSizeMultiplier ?? 1);
    const bidDistance =
      quote.fairPrice * ((halfSpreadBps * clamp(1 + inventoryRatio, 0.35, 1.75)) / 10_000);
    const askDistance =
      quote.fairPrice * ((halfSpreadBps * clamp(1 - inventoryRatio, 0.35, 1.75)) / 10_000);
    const bid = reservationPrice - bidDistance;
    const ask = reservationPrice + askDistance;

    return {
      level: index,
      halfSpreadBps,
      bid: position.qty < 0 && position.avgEntry > 0 ? Math.min(bid, position.avgEntry) : bid,
      ask: position.qty > 0 && position.avgEntry > 0 ? Math.max(ask, position.avgEntry) : ask,
      bidSize,
      askSize,
    };
  }

  private withSideIntentCaps(quote: Quote, position: Position): Quote {
    const levels = quote.levels;
    if (levels === undefined) {
      const [level] = capReduceSideQuantities(
        [
          {
            level: 0,
            halfSpreadBps: 0,
            bid: quote.bid,
            ask: quote.ask,
            bidSize: quote.bidSize,
            askSize: quote.askSize,
          },
        ],
        position.qty,
      );
      if (level === undefined) {
        return quote;
      }
      return {
        ...quote,
        bidSize: level.bidSize,
        askSize: level.askSize,
        bidIntent: level.bidIntent,
        askIntent: level.askIntent,
      };
    }

    const cappedLevels = capReduceSideQuantities(levels, position.qty);
    const top = cappedLevels[0];
    if (top === undefined) {
      return quote;
    }
    return {
      ...quote,
      bidSize: top.bidSize,
      askSize: top.askSize,
      bidIntent: top.bidIntent,
      askIntent: top.askIntent,
      levels: cappedLevels,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function capReduceSideQuantities(
  levels: ReadonlyArray<QuoteLevel>,
  positionQty: number,
): QuoteLevel[] {
  const activePositionQty = isFlatPositionQty(positionQty) ? 0 : positionQty;
  let remainingReduceQty = Math.abs(activePositionQty);
  return levels.map((level) => {
    const bidIntent = sideIntent("buy", level.bidSize, activePositionQty);
    const askIntent = sideIntent("sell", level.askSize, activePositionQty);
    let bidSize = level.bidSize;
    let askSize = level.askSize;

    if (bidIntent === "reduce_inventory") {
      bidSize = Math.min(level.bidSize, remainingReduceQty);
      remainingReduceQty -= bidSize;
    }
    if (askIntent === "reduce_inventory") {
      askSize = Math.min(level.askSize, remainingReduceQty);
      remainingReduceQty -= askSize;
    }

    return {
      ...level,
      bidSize,
      askSize,
      bidIntent: bidSize > 0 ? bidIntent : "disabled",
      askIntent: askSize > 0 ? askIntent : "disabled",
    };
  });
}

function sideIntent(side: "buy" | "sell", size: number, positionQty: number): QuoteSideIntent {
  if (size <= 0) {
    return "disabled";
  }
  if (side === "buy" && positionQty < 0) {
    return "reduce_inventory";
  }
  if (side === "sell" && positionQty > 0) {
    return "reduce_inventory";
  }
  return "open_quote";
}
