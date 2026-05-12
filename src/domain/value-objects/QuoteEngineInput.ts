import type { PositionSnapshot } from "./PositionSnapshot";
import type { MarketSnapshot } from "../ports/IMarketFeed";

export type QuoteSideSpec = Readonly<{
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
}>;
