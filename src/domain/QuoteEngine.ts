import type { Position } from "./entities/Position.ts";
import type { OrderTimeInForce, Quote } from "./entities/Quote.ts";
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
    return this.strategy.computeQuote({
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
  }

  private computeQuoteSize(fairPrice: number): number {
    if (this.config.budgetUsd === undefined || fairPrice <= 0) {
      return this.config.positionSize;
    }

    return Math.min(this.config.positionSize, this.config.budgetUsd / fairPrice);
  }
}
