import type { Quote, QuoteContext } from "../../entities/Quote.ts";
import type { IQuotingStrategy } from "../IQuotingStrategy.ts";
import type { BulkBetaLeaderboardParams } from "./BulkBetaLeaderboardParams.ts";

export class BulkBetaLeaderboardStrategy implements IQuotingStrategy {
  readonly name = "bulk-beta-leaderboard";

  constructor(private readonly params: BulkBetaLeaderboardParams) {}

  computeQuote(context: QuoteContext): Quote {
    const halfSpread = this.computeHalfSpread(context);
    const inventory = this.inventoryState(context.positionQty);
    const bidDistance = halfSpread * inventory.bidDistanceMultiplier;
    const askDistance = halfSpread * inventory.askDistanceMultiplier;
    const policy =
      context.marginRatio !== null && context.marginRatio < context.slideMarginThreshold
        ? "IOC"
        : context.defaultTimeInForce;

    return {
      bid: Math.max(0, context.fairPrice - bidDistance),
      ask: Math.max(0, context.fairPrice + askDistance),
      bidSize: context.quoteSize * inventory.bidSizeMultiplier,
      askSize: context.quoteSize * inventory.askSizeMultiplier,
      bidSizeMultiplier: inventory.bidSizeMultiplier,
      askSizeMultiplier: inventory.askSizeMultiplier,
      policy,
      fairPrice: context.fairPrice,
      sigma: context.sigma,
    };
  }

  private computeHalfSpread(context: QuoteContext): number {
    const volatilityBps = context.fairPrice <= 0 ? 0 : (context.sigma / context.fairPrice) * 10_000;
    const halfSpreadBps = clamp(
      this.params.baseHalfSpreadBps + volatilityBps * this.params.volatilitySpreadMultiplier,
      this.params.minHalfSpreadBps,
      this.params.maxHalfSpreadBps,
    );
    return context.fairPrice * (halfSpreadBps / 10_000);
  }

  private inventoryState(positionQty: number): {
    bidSizeMultiplier: number;
    askSizeMultiplier: number;
    bidDistanceMultiplier: number;
    askDistanceMultiplier: number;
  } {
    const direction = Math.sign(positionQty);
    const absQty = Math.abs(positionQty);
    const softProgress = clamp(absQty / this.params.inventorySoftLimitQty, 0, 1);
    const sameSideSizeMultiplier =
      absQty >= this.params.inventoryHardLimitQty
        ? 0
        : interpolate(1, this.params.sameSideSizeMultiplierAtSoft, softProgress);
    const reduceSideSizeMultiplier = interpolate(
      1,
      this.params.reduceSideSizeMultiplierAtSoft,
      softProgress,
    );
    const sameSideDistanceMultiplier =
      sameSideSizeMultiplier === 0 ? 2 : 1 / sameSideSizeMultiplier;
    const reduceSideDistanceMultiplier = 1 / reduceSideSizeMultiplier;

    if (direction > 0) {
      return {
        bidSizeMultiplier: sameSideSizeMultiplier,
        askSizeMultiplier: reduceSideSizeMultiplier,
        bidDistanceMultiplier: sameSideDistanceMultiplier,
        askDistanceMultiplier: reduceSideDistanceMultiplier,
      };
    }
    if (direction < 0) {
      return {
        bidSizeMultiplier: reduceSideSizeMultiplier,
        askSizeMultiplier: sameSideSizeMultiplier,
        bidDistanceMultiplier: reduceSideDistanceMultiplier,
        askDistanceMultiplier: sameSideDistanceMultiplier,
      };
    }
    return {
      bidSizeMultiplier: 1,
      askSizeMultiplier: 1,
      bidDistanceMultiplier: 1,
      askDistanceMultiplier: 1,
    };
  }
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
