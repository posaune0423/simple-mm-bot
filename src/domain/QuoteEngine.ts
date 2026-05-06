import type { Position } from "./entities/Position.ts";
import type { OrderTimeInForce, Quote, QuoteLevel } from "./entities/Quote.ts";
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
    return this.withConfiguredLevels(quote, position.qty);
  }

  private computeQuoteSize(fairPrice: number): number {
    if (this.config.budgetUsd === undefined || fairPrice <= 0) {
      return this.config.positionSize;
    }

    return Math.min(this.config.positionSize, this.config.budgetUsd / fairPrice);
  }

  private withConfiguredLevels(quote: Quote, positionQty: number): Quote {
    if (this.config.levels === undefined) {
      return quote;
    }

    const levels = this.config.levels.map((level, index) =>
      this.configuredLevel(quote, positionQty, level, index),
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
    positionQty: number,
    levelConfig: QuoteLadderLevelConfig,
    index: number,
  ): QuoteLevel {
    const reservationPrice = (quote.bid + quote.ask) / 2;
    const minHalfSpreadBps = (this.config.minSpreadBps ?? 0) / 2;
    const halfSpreadBps = Math.max(levelConfig.halfSpreadBps, minHalfSpreadBps);
    const distance = quote.fairPrice * (halfSpreadBps / 10_000);
    const size = levelConfig.sizeUsd / quote.fairPrice;
    const inventoryRatio = Math.tanh(positionQty / this.config.inventoryScale);
    const bidSize = size * clamp(1 - inventoryRatio, 0.25, 1.75);
    const askSize = size * clamp(1 + inventoryRatio, 0.25, 1.75);

    return {
      level: index,
      halfSpreadBps,
      bid: reservationPrice - distance,
      ask: reservationPrice + distance,
      bidSize,
      askSize,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
