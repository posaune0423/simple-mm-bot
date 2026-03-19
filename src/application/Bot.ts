import type { Report } from "../domain/entities/Report.ts";
import type { Fill } from "../domain/entities/Fill.ts";
import type { IMarketFeed } from "../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../domain/ports/IOrderGateway.ts";
import type { RiskState } from "./usecases/GuardRiskUseCase.ts";

interface UseCases {
  guardRisk: { execute(): Promise<RiskState> };
  refreshQuotes: { execute(): Promise<void> };
  recordFill: { execute(fill: Fill): Promise<void> };
  reduceInventory: { executeIfNeeded(): Promise<boolean> };
  buildReport: {
    execute(periodStart: number, periodEnd: number, quotedCount: number): Promise<Report>;
  };
}

export class Bot {
  private running = false;
  private quotedCount = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly useCases: UseCases,
    private readonly marketFeed: IMarketFeed,
    private readonly orderGateway: IOrderGateway,
    private readonly intervalMs: number,
  ) {}

  async start(maxTicks?: number): Promise<Report> {
    this.running = true;
    await this.marketFeed.connect();
    this.unsubscribers.push(
      this.orderGateway.subscribeFills((fill) => {
        void this.useCases.recordFill.execute(fill);
      }),
    );

    const startedAt = Date.now();
    let ticks = 0;

    for (;;) {
      if (!this.isRunning()) {
        break;
      }
      const riskState = await this.useCases.guardRisk.execute();
      if (riskState === "EMERGENCY_STOP") {
        await this.orderGateway.cancelAll();
        this.stop();
        break;
      }
      if (riskState === "OK") {
        await this.useCases.refreshQuotes.execute();
        this.quotedCount += 2;
      }
      await this.useCases.reduceInventory.executeIfNeeded();
      if ("advance" in this.marketFeed && typeof this.marketFeed.advance === "function") {
        const hasNext = await this.marketFeed.advance();
        if (!hasNext) {
          this.stop();
        }
      }
      ticks += 1;
      if (maxTicks !== undefined && ticks >= maxTicks) {
        this.stop();
        break;
      }
      if (!this.isRunning()) {
        break;
      }
      await Bun.sleep(this.intervalMs);
    }

    await this.marketFeed.disconnect();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    return this.useCases.buildReport.execute(startedAt, Date.now(), this.quotedCount);
  }

  stop(): void {
    this.running = false;
  }

  private isRunning(): boolean {
    return this.running;
  }
}
