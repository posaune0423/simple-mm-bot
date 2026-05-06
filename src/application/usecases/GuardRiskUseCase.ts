import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";
import { logger } from "../../utils/logger.ts";

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
      logger.debug(`guard_risk.ok market=${snapshot.market} marginRatio=null`);
      return "OK";
    }
    if (marginRatio < this.thresholds.mmrBuffer) {
      logger.warn(
        `guard_risk.emergency_stop market=${snapshot.market} marginRatio=${marginRatio} mmrBuffer=${this.thresholds.mmrBuffer}`,
      );
      return "EMERGENCY_STOP";
    }
    if (marginRatio < this.thresholds.imrBuffer) {
      logger.warn(
        `guard_risk.pause_quoting market=${snapshot.market} marginRatio=${marginRatio} imrBuffer=${this.thresholds.imrBuffer}`,
      );
      return "PAUSE_QUOTING";
    }
    logger.debug(`guard_risk.ok market=${snapshot.market} marginRatio=${marginRatio}`);
    return "OK";
  }
}
