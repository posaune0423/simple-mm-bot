import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";

export type RiskState = "OK" | "PAUSE_QUOTING" | "EMERGENCY_STOP";

export class GuardRiskUseCase {
  constructor(
    private readonly marketFeed: IMarketFeed,
    private readonly thresholds: { imrBuffer: number; mmrBuffer: number },
  ) {}

  async execute(): Promise<RiskState> {
    const snapshot = await this.marketFeed.getSnapshot();
    const marginRatio = snapshot.marginRatio;

    if (marginRatio === null) {
      return "OK";
    }
    if (marginRatio < this.thresholds.mmrBuffer) {
      return "EMERGENCY_STOP";
    }
    if (marginRatio < this.thresholds.imrBuffer) {
      return "PAUSE_QUOTING";
    }
    return "OK";
  }
}
