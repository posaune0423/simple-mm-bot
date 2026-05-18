import type { FairValueSnapshot } from "../external-market/FairValueTypes.ts";

export interface IFairValueProvider {
  getLatestFairValue(nowMs: number): FairValueSnapshot;
}
