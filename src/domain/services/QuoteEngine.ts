import { err, ok, type Result } from "neverthrow";
import {
  InvalidQuoteEngineInputError,
  QuoteModelFailedError,
  type QuoteEngineError,
} from "../errors/DomainError.ts";
import type { QuoteModel, QuoteModelSignals } from "../quote-models/QuoteModel.ts";
import type { MarketSnapshot } from "../ports/IMarketFeed.ts";
import type { ExposureIntent, OrderSide, QuoteSide } from "../value-objects/QuoteLeg.ts";
import { QuoteLeg } from "../value-objects/QuoteLeg.ts";
import { Price } from "../value-objects/Price.ts";
import { Quantity } from "../value-objects/Quantity.ts";
import { BasisPoints } from "../value-objects/BasisPoints.ts";
import { Quote } from "../value-objects/Quote.ts";
import { PositionSnapshot } from "../value-objects/PositionSnapshot.ts";
import type { FairPriceCalculator } from "./FairPriceCalculator.ts";
import type { VolatilityEstimator } from "./VolatilityEstimator.ts";

type QuoteSideSpec = Readonly<{
  enabled: boolean;
  distanceMultiplier: number;
  sizeMultiplier: number;
  disableIncreaseExposure: boolean;
  reasonTags: readonly string[];
}>;

export type QuoteSideSpecs = Readonly<{
  bid: QuoteSideSpec;
  ask: QuoteSideSpec;
}>;

export type QuoteEngineInput = Readonly<{
  snapshot: MarketSnapshot;
  position: PositionSnapshot;
  sideSpecs: QuoteSideSpecs;
  modelSignals?: QuoteModelSignals;
}>;

type QuoteEngineConfig = Readonly<{
  inventoryScale: number;
  timeHorizonSec: number;
  minSpreadBps?: number;
  positionSize: number;
  budgetUsd?: number;
  bidSizeMultiplier?: number;
  askSizeMultiplier?: number;
  bidDistanceMultiplier?: number;
  askDistanceMultiplier?: number;
  reduceQuoteMinPositionQty?: number;
  maxLeverage?: number;
  levels?: readonly QuoteLadderLevelConfig[];
}>;

type QuoteLadderLevelConfig = Readonly<{
  halfSpreadBps: number;
  sizeUsd: number;
}>;

type LevelDraft = Readonly<{
  level: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
}>;

const OPEN_NOTIONAL_SAFETY_BUFFER = 0.95;
const POSITION_QTY_EPSILON = 1e-12;

export class QuoteEngine {
  constructor(
    private readonly quoteModel: QuoteModel,
    private readonly fairCalc: FairPriceCalculator,
    private readonly volEst: VolatilityEstimator,
    private readonly config: QuoteEngineConfig,
  ) {}

  compute(input: QuoteEngineInput): Result<Quote, QuoteEngineError> {
    const fairPriceValue = this.fairCalc.compute(input.snapshot);
    const fairPrice = Price.create(fairPriceValue, "fairPrice");
    if (fairPrice.isErr()) {
      return err(fairPrice.error);
    }

    const referencePrice = Price.create(input.snapshot.markPrice, "referencePrice");
    if (referencePrice.isErr()) {
      return err(referencePrice.error);
    }

    const sigma = this.volEst.update(input.snapshot.markPrice, input.snapshot.timestamp);
    if (!Number.isFinite(sigma) || sigma < 0) {
      return err(
        new InvalidQuoteEngineInputError(`sigma must be finite and non-negative: ${sigma}`, {
          context: { sigma },
        }),
      );
    }

    const quoteSize = Quantity.create(this.computeQuoteSize(fairPrice.value), "quoteSize");
    if (quoteSize.isErr()) {
      return err(quoteSize.error);
    }

    let minSpreadBps: BasisPoints | undefined;
    if (this.config.minSpreadBps !== undefined) {
      const created = BasisPoints.createNonNegative(this.config.minSpreadBps, "minSpreadBps");
      if (created.isErr()) {
        return err(created.error);
      }
      minSpreadBps = created.value;
    }

    const modelQuote = this.quoteModel.compute({
      fairPrice: fairPrice.value,
      volatilitySigma: sigma,
      quoteSize: quoteSize.value,
      positionQty: input.position.signedQuantity,
      inventoryScale: this.config.inventoryScale,
      timeHorizonSec: this.config.timeHorizonSec,
      minSpreadBps,
      signals: input.modelSignals,
    });
    if (modelQuote.isErr()) {
      return err(new QuoteModelFailedError(this.quoteModel.name, modelQuote.error));
    }

    const levels = this.withOpenNotionalCaps(
      this.withReduceCaps(
        this.withSideSpecs(
          this.withConfiguredSideMultipliers(this.buildLevels(modelQuote.value)),
          input,
        ),
        input,
      ),
      input,
      fairPrice.value,
    );
    const bids = [];
    const asks = [];

    for (const level of levels) {
      const bidIntent = this.exposureIntentForOrderSide(input, "buy");
      const askIntent = this.exposureIntentForOrderSide(input, "sell");
      const bid = this.quoteLeg(
        "bid",
        "buy",
        level.level,
        level.bid,
        level.bidSize,
        bidIntent,
        input,
      );
      if (bid.isErr()) {
        return err(bid.error);
      }
      if (bid.value !== undefined) {
        bids.push(bid.value);
      }

      const ask = this.quoteLeg(
        "ask",
        "sell",
        level.level,
        level.ask,
        level.askSize,
        askIntent,
        input,
      );
      if (ask.isErr()) {
        return err(ask.error);
      }
      if (ask.value !== undefined) {
        asks.push(ask.value);
      }
    }

    return Quote.create({
      market: input.snapshot.market,
      bids,
      asks,
      referencePrice: referencePrice.value,
      fairPrice: fairPrice.value,
      reservationPrice: modelQuote.value.reservationPrice,
      sigma,
      diagnostics: {
        quoteModel: modelQuote.value.diagnostics.modelName,
        reasonTags: [...collectReasonTags(bids), ...collectReasonTags(asks)],
        alphaDriftBps: modelQuote.value.diagnostics.alphaDriftBps,
        fundingRateBps: modelQuote.value.diagnostics.fundingRateBps,
        expectedFundingBps: modelQuote.value.diagnostics.expectedFundingBps,
        basisBps: modelQuote.value.diagnostics.basisBps,
        targetInventoryQty: modelQuote.value.diagnostics.targetInventoryQty,
        inventoryErrorQty: modelQuote.value.diagnostics.inventoryErrorQty,
      },
    });
  }

  private quoteLeg(
    quoteSide: QuoteSide,
    orderSide: OrderSide,
    level: number,
    priceValue: number,
    sizeValue: number,
    exposureIntent: ExposureIntent,
    input: QuoteEngineInput,
  ): Result<QuoteLeg | undefined, QuoteEngineError> {
    const spec = quoteSide === "bid" ? input.sideSpecs.bid : input.sideSpecs.ask;
    if (!spec.enabled) {
      return ok(undefined);
    }
    if (spec.disableIncreaseExposure && exposureIntent === "increase_exposure") {
      return ok(undefined);
    }
    if (
      exposureIntent === "reduce_exposure" &&
      Math.abs(input.position.signedQuantity) <=
        (this.config.reduceQuoteMinPositionQty ?? 0) + POSITION_QTY_EPSILON
    ) {
      return ok(undefined);
    }
    if (sizeValue <= 0) {
      return ok(undefined);
    }

    const price = Price.create(priceValue, `${quoteSide}[${level}].price`);
    if (price.isErr()) {
      return err(price.error);
    }
    const size = Quantity.create(sizeValue, `${quoteSide}[${level}].size`);
    if (size.isErr()) {
      return err(size.error);
    }

    return QuoteLeg.create({
      side: quoteSide,
      price: price.value,
      size: size.value,
      level,
      exposureIntent,
      reasonTags: spec.reasonTags,
    });
  }

  private buildLevels(modelQuote: {
    bidPrice: number;
    askPrice: number;
    bidQuantity: number;
    askQuantity: number;
    fairPrice: number;
  }): LevelDraft[] {
    if (this.config.levels === undefined) {
      return [
        {
          level: 0,
          bid: modelQuote.bidPrice,
          ask: modelQuote.askPrice,
          bidSize: modelQuote.bidQuantity,
          askSize: modelQuote.askQuantity,
        },
      ];
    }

    const reservationPrice = (modelQuote.bidPrice + modelQuote.askPrice) / 2;
    const minHalfSpreadBps = (this.config.minSpreadBps ?? 0) / 2;
    return this.config.levels.map((level, index) => {
      const halfSpreadBps = Math.max(level.halfSpreadBps, minHalfSpreadBps);
      const size = level.sizeUsd / modelQuote.fairPrice;
      const bidDistance = modelQuote.fairPrice * (halfSpreadBps / 10_000);
      const askDistance = modelQuote.fairPrice * (halfSpreadBps / 10_000);
      return {
        level: index,
        bid: reservationPrice - bidDistance,
        ask: reservationPrice + askDistance,
        bidSize: size,
        askSize: size,
      };
    });
  }

  private withConfiguredSideMultipliers(levels: readonly LevelDraft[]): LevelDraft[] {
    return levels.map((level) => ({
      ...level,
      bid: distanceFromFair(level.bid, this.config.bidDistanceMultiplier ?? 1, "bid"),
      ask: distanceFromFair(level.ask, this.config.askDistanceMultiplier ?? 1, "ask"),
      bidSize: level.bidSize * (this.config.bidSizeMultiplier ?? 1),
      askSize: level.askSize * (this.config.askSizeMultiplier ?? 1),
    }));

    function distanceFromFair(price: number, multiplier: number, side: QuoteSide): number {
      const fair = levels[0] === undefined ? price : (levels[0].bid + levels[0].ask) / 2;
      return side === "bid"
        ? fair - (fair - price) * multiplier
        : fair + (price - fair) * multiplier;
    }
  }

  private withSideSpecs(levels: readonly LevelDraft[], input: QuoteEngineInput): LevelDraft[] {
    const center = levels[0] === undefined ? undefined : (levels[0].bid + levels[0].ask) / 2;
    return levels.map((level) => ({
      ...level,
      bid: sideDistance(level.bid, input.sideSpecs.bid, "bid"),
      ask: sideDistance(level.ask, input.sideSpecs.ask, "ask"),
      bidSize: level.bidSize * input.sideSpecs.bid.sizeMultiplier,
      askSize: level.askSize * input.sideSpecs.ask.sizeMultiplier,
    }));

    function sideDistance(price: number, spec: QuoteSideSpec, side: QuoteSide): number {
      const fair = center ?? price;
      return side === "bid"
        ? fair - (fair - price) * spec.distanceMultiplier
        : fair + (price - fair) * spec.distanceMultiplier;
    }
  }

  private withReduceCaps(levels: readonly LevelDraft[], input: QuoteEngineInput): LevelDraft[] {
    let remainingReduceQty = PositionSnapshot.maxReduceQuantity(input.position);
    return levels.map((level) => {
      const bidIntent = this.exposureIntentForOrderSide(input, "buy");
      const askIntent = this.exposureIntentForOrderSide(input, "sell");
      let bidSize = level.bidSize;
      let askSize = level.askSize;

      if (bidIntent === "reduce_exposure") {
        bidSize = Math.min(bidSize, remainingReduceQty);
        remainingReduceQty -= bidSize;
      }
      if (askIntent === "reduce_exposure") {
        askSize = Math.min(askSize, remainingReduceQty);
        remainingReduceQty -= askSize;
      }

      return {
        ...level,
        bidSize,
        askSize,
      };
    });
  }

  private withOpenNotionalCaps(
    levels: readonly LevelDraft[],
    input: QuoteEngineInput,
    fairPrice: number,
  ): LevelDraft[] {
    if (fairPrice <= 0) {
      return [...levels];
    }

    const maxSideQty =
      this.config.budgetUsd === undefined ? undefined : this.config.budgetUsd / fairPrice;
    const maxCombinedQty =
      input.snapshot.availableMarginUsd === undefined ||
      input.snapshot.availableMarginUsd === null ||
      input.snapshot.availableMarginUsd < 0 ||
      this.config.maxLeverage === undefined
        ? undefined
        : Math.max(
            0,
            (input.snapshot.availableMarginUsd *
              this.config.maxLeverage *
              OPEN_NOTIONAL_SAFETY_BUFFER) /
              fairPrice -
              Math.abs(input.position.signedQuantity),
          );
    if (maxSideQty === undefined && maxCombinedQty === undefined) {
      return [...levels];
    }

    const bidIntent = this.exposureIntentForOrderSide(input, "buy");
    const askIntent = this.exposureIntentForOrderSide(input, "sell");
    const bidIncreaseAllowed = isIncreaseAllowed(input.sideSpecs.bid, bidIntent);
    const askIncreaseAllowed = isIncreaseAllowed(input.sideSpecs.ask, askIntent);
    const totalBidOpenQty = levels.reduce(
      (sum, level) => sum + (bidIncreaseAllowed ? level.bidSize : 0),
      0,
    );
    const totalAskOpenQty = levels.reduce(
      (sum, level) => sum + (askIncreaseAllowed ? level.askSize : 0),
      0,
    );
    const bidSideScale =
      maxSideQty !== undefined && totalBidOpenQty > maxSideQty ? maxSideQty / totalBidOpenQty : 1;
    const askSideScale =
      maxSideQty !== undefined && totalAskOpenQty > maxSideQty ? maxSideQty / totalAskOpenQty : 1;
    const totalSideCappedOpenQty = totalBidOpenQty * bidSideScale + totalAskOpenQty * askSideScale;
    const combinedScale =
      maxCombinedQty !== undefined && totalSideCappedOpenQty > maxCombinedQty
        ? maxCombinedQty / totalSideCappedOpenQty
        : 1;

    return levels.map((level) => ({
      ...level,
      bidSize: bidIncreaseAllowed ? level.bidSize * bidSideScale * combinedScale : level.bidSize,
      askSize: askIncreaseAllowed ? level.askSize * askSideScale * combinedScale : level.askSize,
    }));
  }

  private computeQuoteSize(fairPrice: number): number {
    if (this.config.budgetUsd === undefined || fairPrice <= 0) {
      return this.config.positionSize;
    }
    return Math.min(this.config.positionSize, this.config.budgetUsd / fairPrice);
  }

  private exposureIntentForOrderSide(
    input: QuoteEngineInput,
    orderSide: OrderSide,
  ): ExposureIntent {
    if (
      Math.abs(input.position.signedQuantity) <=
      (this.config.reduceQuoteMinPositionQty ?? 0) + POSITION_QTY_EPSILON
    ) {
      return "increase_exposure";
    }
    return PositionSnapshot.exposureIntentForOrderSide(input.position, orderSide);
  }
}

function isIncreaseAllowed(spec: QuoteSideSpec, intent: ExposureIntent): boolean {
  return intent === "increase_exposure" && spec.enabled && !spec.disableIncreaseExposure;
}

function collectReasonTags(legs: readonly { reasonTags: readonly string[] }[]): string[] {
  return legs.flatMap((leg) => [...leg.reasonTags]);
}
