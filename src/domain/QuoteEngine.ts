import type { Position } from "./entities/Position.ts";
import { isFlatPositionQty } from "./entities/Position.ts";
import type { QuoteControls } from "./QuoteControls.ts";
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
  bidSizeMultiplier?: number;
  askSizeMultiplier?: number;
  bidDistanceMultiplier?: number;
  askDistanceMultiplier?: number;
  maxLeverage?: number;
  levels?: ReadonlyArray<QuoteLadderLevelConfig>;
}

interface QuoteLadderLevelConfig {
  halfSpreadBps: number;
  sizeUsd: number;
}

const OPEN_NOTIONAL_SAFETY_BUFFER = 0.95;

export class QuoteEngine {
  constructor(
    private readonly strategy: IQuotingStrategy,
    private readonly fairCalc: FairPriceCalculator,
    private readonly volEst: VolatilityEstimator,
    private readonly config: QuoteEngineConfig,
  ) {}

  compute(snapshot: MarketSnapshot, position: Position, controls: QuoteControls = {}): Quote {
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
    return this.withOpenNotionalCaps(
      this.withControlOpenSideDisables(
        this.withSideIntentCaps(
          this.withBudgetCaps(
            this.withControlSideSizeMultipliers(
              this.withConfiguredSideSizeMultipliers(
                this.withControlSideDistanceMultipliers(
                  this.withConfiguredSideDistanceMultipliers(
                    this.withConfiguredLevels(quote, position),
                  ),
                  controls,
                ),
              ),
              controls,
            ),
          ),
          position,
        ),
        controls,
      ),
      snapshot,
      position,
    );
  }

  private withControlSideDistanceMultipliers(quote: Quote, controls: QuoteControls): Quote {
    return this.withSideDistanceMultipliers(
      quote,
      controls.bid?.distanceMultiplier ?? 1,
      controls.ask?.distanceMultiplier ?? 1,
    );
  }

  private withControlSideSizeMultipliers(quote: Quote, controls: QuoteControls): Quote {
    return this.withSideSizeMultipliers(
      quote,
      controls.bid?.sizeMultiplier ?? 1,
      controls.ask?.sizeMultiplier ?? 1,
    );
  }

  private withControlOpenSideDisables(quote: Quote, controls: QuoteControls): Quote {
    const disableBid = controls.bid?.disableOpen === true;
    const disableAsk = controls.ask?.disableOpen === true;
    if (!disableBid && !disableAsk) {
      return this.withControlReasons(quote, controls);
    }

    const levels = quote.levels?.map((level) => {
      const bidDisabled = disableBid && level.bidIntent === "open_quote";
      const askDisabled = disableAsk && level.askIntent === "open_quote";
      return {
        ...level,
        bidSize: bidDisabled ? 0 : level.bidSize,
        askSize: askDisabled ? 0 : level.askSize,
        bidIntent: bidDisabled ? ("disabled" as const) : level.bidIntent,
        askIntent: askDisabled ? ("disabled" as const) : level.askIntent,
        bidControlReasons: controls.bid?.reasonTags,
        askControlReasons: controls.ask?.reasonTags,
      };
    });
    const top = levels?.[0];
    const bidDisabled = disableBid && quote.bidIntent === "open_quote";
    const askDisabled = disableAsk && quote.askIntent === "open_quote";

    return this.withControlReasons(
      {
        ...quote,
        bidSize: top?.bidSize ?? (bidDisabled ? 0 : quote.bidSize),
        askSize: top?.askSize ?? (askDisabled ? 0 : quote.askSize),
        bidIntent: top?.bidIntent ?? (bidDisabled ? "disabled" : quote.bidIntent),
        askIntent: top?.askIntent ?? (askDisabled ? "disabled" : quote.askIntent),
        levels,
      },
      controls,
    );
  }

  private withControlReasons(quote: Quote, controls: QuoteControls): Quote {
    return {
      ...quote,
      bidControlReasons: controls.bid?.reasonTags,
      askControlReasons: controls.ask?.reasonTags,
      levels: quote.levels?.map((level) => ({
        ...level,
        bidControlReasons: controls.bid?.reasonTags,
        askControlReasons: controls.ask?.reasonTags,
      })),
    };
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

  private withConfiguredSideDistanceMultipliers(quote: Quote): Quote {
    return this.withSideDistanceMultipliers(
      quote,
      this.config.bidDistanceMultiplier ?? 1,
      this.config.askDistanceMultiplier ?? 1,
    );
  }

  private withSideDistanceMultipliers(
    quote: Quote,
    bidDistanceMultiplier: number,
    askDistanceMultiplier: number,
  ): Quote {
    if (bidDistanceMultiplier === 1 && askDistanceMultiplier === 1) {
      return quote;
    }

    const bidWithDistance = (price: number) =>
      quote.fairPrice - (quote.fairPrice - price) * bidDistanceMultiplier;
    const askWithDistance = (price: number) =>
      quote.fairPrice + (price - quote.fairPrice) * askDistanceMultiplier;
    const levels = quote.levels?.map((level) => ({
      ...level,
      bid: bidWithDistance(level.bid),
      ask: askWithDistance(level.ask),
    }));

    return {
      ...quote,
      bid: bidWithDistance(quote.bid),
      ask: askWithDistance(quote.ask),
      levels,
    };
  }

  private withConfiguredSideSizeMultipliers(quote: Quote): Quote {
    return this.withSideSizeMultipliers(
      quote,
      this.config.bidSizeMultiplier ?? 1,
      this.config.askSizeMultiplier ?? 1,
    );
  }

  private withSideSizeMultipliers(
    quote: Quote,
    bidSizeMultiplier: number,
    askSizeMultiplier: number,
  ): Quote {
    if (bidSizeMultiplier === 1 && askSizeMultiplier === 1) {
      return quote;
    }

    const levels = quote.levels?.map((level) => ({
      ...level,
      bidSize: level.bidSize * bidSizeMultiplier,
      askSize: level.askSize * askSizeMultiplier,
    }));

    return {
      ...quote,
      bidSize: quote.bidSize * bidSizeMultiplier,
      askSize: quote.askSize * askSizeMultiplier,
      levels,
    };
  }

  private withBudgetCaps(quote: Quote): Quote {
    if (this.config.budgetUsd === undefined || quote.fairPrice <= 0 || quote.levels === undefined) {
      return quote;
    }

    const shouldCapBid = (this.config.bidSizeMultiplier ?? 1) > 1;
    const shouldCapAsk = (this.config.askSizeMultiplier ?? 1) > 1;
    if (!shouldCapBid && !shouldCapAsk) {
      return quote;
    }

    const maxQty = this.config.budgetUsd / quote.fairPrice;
    const totalBidQty = quote.levels.reduce((sum, level) => sum + level.bidSize, 0);
    const totalAskQty = quote.levels.reduce((sum, level) => sum + level.askSize, 0);
    const bidScale = shouldCapBid && totalBidQty > maxQty ? maxQty / totalBidQty : 1;
    const askScale = shouldCapAsk && totalAskQty > maxQty ? maxQty / totalAskQty : 1;
    if (bidScale === 1 && askScale === 1) {
      return quote;
    }

    const levels = quote.levels.map((level) => ({
      ...level,
      bidSize: level.bidSize * bidScale,
      askSize: level.askSize * askScale,
    }));
    const top = levels[0];
    if (top === undefined) {
      return quote;
    }
    return {
      ...quote,
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
    const bidSizeSkew =
      quote.bidDistanceMultiplier === undefined ? clamp(1 - inventoryRatio, 0, 1.75) : 1;
    const askSizeSkew =
      quote.askDistanceMultiplier === undefined ? clamp(1 + inventoryRatio, 0, 1.75) : 1;
    const bidDistanceSkew =
      quote.bidDistanceMultiplier === undefined
        ? clamp(1 + inventoryRatio, 0.35, 1.75)
        : quote.bidDistanceMultiplier;
    const askDistanceSkew =
      quote.askDistanceMultiplier === undefined
        ? clamp(1 - inventoryRatio, 0.35, 1.75)
        : quote.askDistanceMultiplier;
    const bidSize = size * bidSizeSkew * (quote.bidSizeMultiplier ?? 1);
    const askSize = size * askSizeSkew * (quote.askSizeMultiplier ?? 1);
    const bidDistance = quote.fairPrice * ((halfSpreadBps * bidDistanceSkew) / 10_000);
    const askDistance = quote.fairPrice * ((halfSpreadBps * askDistanceSkew) / 10_000);
    const bid = reservationPrice - bidDistance;
    const ask = reservationPrice + askDistance;

    return {
      level: index,
      halfSpreadBps,
      bid,
      ask,
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

  private withOpenNotionalCaps(quote: Quote, snapshot: MarketSnapshot, position: Position): Quote {
    const caps = this.openNotionalCaps(quote, snapshot, position);
    if (caps === undefined) {
      return quote;
    }

    const levels = quote.levels;
    if (levels === undefined) {
      const bidSize =
        quote.bidIntent === "open_quote" && caps.maxSideQty !== undefined
          ? Math.min(quote.bidSize, caps.maxSideQty)
          : quote.bidSize;
      const askSize =
        quote.askIntent === "open_quote" && caps.maxSideQty !== undefined
          ? Math.min(quote.askSize, caps.maxSideQty)
          : quote.askSize;
      const totalOpenQty =
        (quote.bidIntent === "open_quote" ? bidSize : 0) +
        (quote.askIntent === "open_quote" ? askSize : 0);
      const combinedScale =
        caps.maxCombinedQty !== undefined && totalOpenQty > caps.maxCombinedQty
          ? caps.maxCombinedQty / totalOpenQty
          : 1;
      const cappedBidSize = quote.bidIntent === "open_quote" ? bidSize * combinedScale : bidSize;
      const cappedAskSize = quote.askIntent === "open_quote" ? askSize * combinedScale : askSize;
      return {
        ...quote,
        bidSize: cappedBidSize,
        askSize: cappedAskSize,
        bidIntent: cappedBidSize > 0 ? quote.bidIntent : "disabled",
        askIntent: cappedAskSize > 0 ? quote.askIntent : "disabled",
      };
    }

    const totalBidOpenQty = levels.reduce(
      (sum, level) => sum + (level.bidIntent === "open_quote" ? level.bidSize : 0),
      0,
    );
    const totalAskOpenQty = levels.reduce(
      (sum, level) => sum + (level.askIntent === "open_quote" ? level.askSize : 0),
      0,
    );
    const bidSideScale =
      caps.maxSideQty !== undefined && totalBidOpenQty > caps.maxSideQty
        ? caps.maxSideQty / totalBidOpenQty
        : 1;
    const askSideScale =
      caps.maxSideQty !== undefined && totalAskOpenQty > caps.maxSideQty
        ? caps.maxSideQty / totalAskOpenQty
        : 1;
    const totalSideCappedOpenQty = totalBidOpenQty * bidSideScale + totalAskOpenQty * askSideScale;
    const combinedScale =
      caps.maxCombinedQty !== undefined && totalSideCappedOpenQty > caps.maxCombinedQty
        ? caps.maxCombinedQty / totalSideCappedOpenQty
        : 1;
    const bidScale = bidSideScale * combinedScale;
    const askScale = askSideScale * combinedScale;
    if (bidScale === 1 && askScale === 1) {
      return quote;
    }

    const cappedLevels = levels.map((level) => {
      const bidSize = level.bidIntent === "open_quote" ? level.bidSize * bidScale : level.bidSize;
      const askSize = level.askIntent === "open_quote" ? level.askSize * askScale : level.askSize;
      return {
        ...level,
        bidSize,
        askSize,
        bidIntent: bidSize > 0 ? level.bidIntent : "disabled",
        askIntent: askSize > 0 ? level.askIntent : "disabled",
      };
    });
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

  private openNotionalCaps(
    quote: Quote,
    snapshot: MarketSnapshot,
    position: Position,
  ): { maxSideQty?: number; maxCombinedQty?: number } | undefined {
    if (quote.fairPrice <= 0) {
      return undefined;
    }

    let maxSideQty: number | undefined;
    if (this.config.budgetUsd !== undefined) {
      maxSideQty = this.config.budgetUsd / quote.fairPrice;
    }
    let maxCombinedQty: number | undefined;
    if (
      snapshot.availableMarginUsd !== undefined &&
      snapshot.availableMarginUsd !== null &&
      snapshot.availableMarginUsd >= 0 &&
      this.config.maxLeverage !== undefined
    ) {
      const maxGrossExposureQty =
        (snapshot.availableMarginUsd * this.config.maxLeverage * OPEN_NOTIONAL_SAFETY_BUFFER) /
        quote.fairPrice;
      maxCombinedQty = Math.max(0, maxGrossExposureQty - Math.abs(position.qty));
    }

    return maxSideQty === undefined && maxCombinedQty === undefined
      ? undefined
      : { maxSideQty, maxCombinedQty };
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
