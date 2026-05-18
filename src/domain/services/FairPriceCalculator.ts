import type { MarketSnapshot, OrderBookLevel } from "../ports/IMarketFeed.ts";
import type { IFairValueProvider } from "../ports/IFairValueProvider.ts";
import type { FairValueSnapshot } from "../external-market/FairValueTypes.ts";

export type BookPriceSource = "micro" | "vamp";
export type ExternalFairPriceMode = "disabled" | "replace_local" | "blend_with_local";
export type ExternalFairPriceConfig = Readonly<{
  enabled: boolean;
  mode: ExternalFairPriceMode;
  localWeight?: number;
}>;

export type FairPriceComputation =
  | Readonly<{
      status: "ok";
      fairPrice: number;
      localFairPrice: number;
      priceSource: "local" | "external" | "blended";
      externalFair?: FairValueSnapshot;
    }>
  | Readonly<{
      status: "unavailable";
      localFairPrice: number;
      reason: "external_fair_unavailable";
      externalFair?: FairValueSnapshot;
    }>;

export class FairPriceCalculator {
  constructor(
    private readonly markWeight: number,
    private readonly bookPriceSource: BookPriceSource = "micro",
    private readonly fairValueProvider?: IFairValueProvider,
    private readonly externalFairConfig: ExternalFairPriceConfig = {
      enabled: false,
      mode: "disabled",
    },
  ) {}

  compute(snapshot: MarketSnapshot): number {
    return this.computeLocalFair(snapshot);
  }

  computeWithDiagnostics(snapshot: MarketSnapshot, nowMs = Date.now()): FairPriceComputation {
    const localFairPrice = this.computeLocalFair(snapshot);
    if (
      !this.externalFairConfig.enabled ||
      this.externalFairConfig.mode === "disabled" ||
      this.fairValueProvider === undefined
    ) {
      return {
        status: "ok",
        fairPrice: localFairPrice,
        localFairPrice,
        priceSource: "local",
      };
    }

    const externalFair = this.fairValueProvider.getLatestFairValue(nowMs);
    if (externalFair.status === "unavailable" || externalFair.fairMid === undefined) {
      return {
        status: "unavailable",
        localFairPrice,
        reason: "external_fair_unavailable",
        externalFair,
      };
    }

    if (this.externalFairConfig.mode === "replace_local") {
      return {
        status: "ok",
        fairPrice: externalFair.fairMid,
        localFairPrice,
        priceSource: "external",
        externalFair,
      };
    }

    const localWeight = this.externalFairConfig.localWeight ?? 0.5;
    return {
      status: "ok",
      fairPrice: localWeight * localFairPrice + (1 - localWeight) * externalFair.fairMid,
      localFairPrice,
      priceSource: "blended",
      externalFair,
    };
  }

  private computeLocalFair(snapshot: MarketSnapshot): number {
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
