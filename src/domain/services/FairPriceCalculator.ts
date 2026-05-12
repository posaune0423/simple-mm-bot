import type { MarketSnapshot, OrderBookLevel } from "../ports/IMarketFeed.ts";

export type BookPriceSource = "micro" | "vamp";

export class FairPriceCalculator {
  constructor(
    private readonly markWeight: number,
    private readonly bookPriceSource: BookPriceSource = "micro",
  ) {}

  compute(snapshot: MarketSnapshot): number {
    const bookPrice =
      this.bookPriceSource === "vamp"
        ? (snapshot.vampPrice ?? snapshot.microPrice)
        : snapshot.microPrice;
    return this.markWeight * snapshot.markPrice + (1 - this.markWeight) * bookPrice;
  }
}

export function calculateDepthVampPrice(levels: ReadonlyArray<OrderBookLevel>): number | undefined {
  let numerator = 0;
  let denominator = 0;

  for (const level of levels) {
    if (
      !Number.isFinite(level.bidPrice) ||
      !Number.isFinite(level.askPrice) ||
      !Number.isFinite(level.bidSize) ||
      !Number.isFinite(level.askSize) ||
      level.bidSize <= 0 ||
      level.askSize <= 0
    ) {
      continue;
    }
    numerator += level.bidPrice * level.askSize + level.askPrice * level.bidSize;
    denominator += level.bidSize + level.askSize;
  }

  if (denominator === 0) {
    return undefined;
  }
  return numerator / denominator;
}
