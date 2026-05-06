import type { Report } from "../domain/entities/Report.ts";
import type { Fill } from "../domain/entities/Fill.ts";
import type { IMarketFeed, MarketSnapshot } from "../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../domain/ports/IOrderGateway.ts";
import { logger } from "../utils/logger.ts";
import type { RiskState } from "./usecases/GuardRiskUseCase.ts";

interface UseCases {
  guardRisk: { execute(): Promise<RiskState> };
  refreshQuotes: { execute(): Promise<void> };
  recordFill: { execute(fill: Fill): Promise<void> };
  recordOhlcv: { execute(snapshot: MarketSnapshot): Promise<void> };
  reduceInventory: { executeIfNeeded(): Promise<boolean> };
  closePosition: { execute(): Promise<void> };
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
    const startedAt = Date.now();
    let startError: unknown;
    let closePositionError: unknown;
    logger.info(`bot.start intervalMs=${this.intervalMs} maxTicks=${maxTicks ?? "unbounded"}`);

    try {
      await this.marketFeed.connect();
      logger.info("bot.market_feed_connected");
      this.unsubscribers.push(
        this.marketFeed.subscribe((snapshot) => {
          void this.recordOhlcv(snapshot);
        }),
        this.orderGateway.subscribeFills((fill) => {
          logger.info(
            `bot.fill_received market=${fill.market} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
          );
          void this.useCases.recordFill.execute(fill);
        }),
      );
      logger.info("bot.market_snapshot_subscription_active");
      logger.info("bot.fill_subscription_active");
      await this.recordOhlcv(await this.marketFeed.getSnapshot());

      let ticks = 0;

      for (;;) {
        if (!this.isRunning()) {
          break;
        }
        const riskState = await this.useCases.guardRisk.execute();
        logger.debug(`bot.tick tick=${ticks + 1} riskState=${riskState}`);
        if (riskState === "EMERGENCY_STOP") {
          logger.warn(`bot.stopping reason=emergency_stop tick=${ticks + 1}`);
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
            logger.info(`bot.stopping reason=market_feed_exhausted tick=${ticks + 1}`);
            this.stop();
          }
        }
        ticks += 1;
        if (maxTicks !== undefined && ticks >= maxTicks) {
          logger.info(`bot.stopping reason=max_ticks tick=${ticks}`);
          this.stop();
          break;
        }
        if (!this.isRunning()) {
          break;
        }
        await Bun.sleep(this.intervalMs);
      }
    } catch (err) {
      startError = err;
    } finally {
      this.running = false;
      logger.info("bot.cleanup_started");
      await this.orderGateway
        .cancelAll()
        .catch((err) => logger.error(`bot.cleanup.cancel_all_failed: ${err}`));
      await this.useCases.closePosition.execute().catch((err) => {
        closePositionError = err;
        logger.error(`bot.cleanup.close_position_failed: ${err}`);
      });
      await this.marketFeed.disconnect();
      for (const unsubscribe of this.unsubscribers.splice(0)) {
        unsubscribe();
      }
      await this.orderGateway.dispose?.();
      if (closePositionError === undefined) {
        logger.info(`bot.cleanup_complete quotedCount=${this.quotedCount}`);
      } else {
        logger.error(`bot.cleanup_failed quotedCount=${this.quotedCount} closePositionFailed=true`);
      }
    }

    if (startError !== undefined) {
      throw startError;
    }
    if (closePositionError !== undefined) {
      throw closePositionError;
    }

    return this.useCases.buildReport.execute(startedAt, Date.now(), this.quotedCount);
  }

  stop(): void {
    this.running = false;
  }

  private isRunning(): boolean {
    return this.running;
  }

  private async recordOhlcv(snapshot: MarketSnapshot): Promise<void> {
    await this.useCases.recordOhlcv.execute(snapshot).catch((err) => {
      logger.warn(
        `bot.market_snapshot_record_failed market=${snapshot.market} ts=${snapshot.timestamp} error=${String(err)}`,
      );
    });
  }
}
