import type { ExternalVenueId } from "./ExternalMarketTypes.ts";

export type FairValueStatus = "ready" | "degraded" | "unavailable";
export type FairValueExclusionReason =
  | "missing"
  | "stale"
  | "invalid_bbo"
  | "invalid_weight"
  | "wide_spread"
  | "outlier";

export type FairValueComponent = Readonly<{
  venue: ExternalVenueId;
  symbol: string;
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  ageMs: number;
  spreadBps: number;
  weight: number;
}>;

export type FairValueExclusion = Readonly<{
  venue: ExternalVenueId;
  symbol: string;
  reason: FairValueExclusionReason;
}>;

export type FairValueSnapshot = Readonly<{
  status: FairValueStatus;
  computedAt: number;
  fairBid?: number;
  fairAsk?: number;
  fairMid?: number;
  minAgeMs?: number;
  maxAgeMs?: number;
  used: readonly FairValueComponent[];
  excluded: readonly FairValueExclusion[];
}>;
