import type { MarketSnapshot } from "./ports/IMarketFeed.ts";

export class FairPriceCalculator {
  constructor(private readonly markWeight: number) {}

  compute(snapshot: MarketSnapshot): number {
    return this.markWeight * snapshot.markPrice + (1 - this.markWeight) * snapshot.microPrice;
  }
}
