import type { Report } from "../domain/entities/Report.ts";
import type { Fill } from "../domain/entities/Fill.ts";
import type { IMarketFeed, MarketSnapshot } from "../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../domain/ports/IOrderGateway.ts";
import { logger } from "../utils/logger.ts";
import type { TelemetryRecorder } from "./TelemetryRecorder.ts";
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

type TickResult = "continue" | "stop";

export class Bot {
  private running = false;
  private quotedCount = 0;
  private eventTasks: Promise<void> = Promise.resolve();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly useCases: UseCases,
    private readonly marketFeed: IMarketFeed,
    private readonly orderGateway: IOrderGateway,
    private readonly intervalMs: number,
    private readonly telemetry?: TelemetryRecorder,
  ) {}

  async start(maxTicks?: number): Promise<Report> {
    this.running = true;
    const startedAt = Date.now();
    let runError: unknown;
    let closePositionError: unknown;
    logger.info(`bot.start intervalMs=${this.intervalMs} maxTicks=${maxTicks ?? "unbounded"}`);

    try {
      await this.telemetry?.start(startedAt);
      await this.connectAndSubscribe();
      await this.runLoop(maxTicks);
    } catch (err) {
      runError = err;
      await this.telemetry?.recordRuntimeHealth("error", "runtime_error", String(err));
    } finally {
      closePositionError = await this.cleanup();
      await this.telemetry?.finish(
        Date.now(),
        runError === undefined && closePositionError === undefined ? "completed" : "failed",
      );
    }

    if (runError !== undefined) {
      throw runError;
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

  private async connectAndSubscribe(): Promise<void> {
    await this.marketFeed.connect();
    logger.info("bot.market_feed_connected");
    await this.orderGateway.syncFills?.();
    this.unsubscribers.push(
      this.marketFeed.subscribe((snapshot) => {
        this.enqueueEventTask(async () => this.recordOhlcv(snapshot));
      }),
      this.orderGateway.subscribeFills((fill) => {
        logger.info(
          `bot.fill_received market=${fill.market} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
        );
        this.enqueueEventTask(async () => {
          await this.telemetry?.recordFill(fill);
          await this.useCases.recordFill.execute(fill);
        });
      }),
    );
    if (this.orderGateway.subscribeOrderEvents !== undefined) {
      this.unsubscribers.push(
        this.orderGateway.subscribeOrderEvents((event) => {
          this.enqueueEventTask(async () => {
            await this.telemetry?.recordOrder(event);
          });
        }),
      );
    }
    logger.info("bot.market_snapshot_subscription_active");
    logger.info("bot.fill_subscription_active");
    await this.recordOhlcv(await this.marketFeed.getSnapshot());
  }

  private async runLoop(maxTicks?: number): Promise<void> {
    let ticks = 0;

    while (this.isRunning()) {
      const tick = ticks + 1;
      const tickResult = await this.runTick(tick);
      ticks = tick;

      if (tickResult === "stop" || this.hasReachedMaxTicks(ticks, maxTicks) || !this.isRunning()) {
        break;
      }

      await Bun.sleep(this.intervalMs);
    }
  }

  private async runTick(tick: number): Promise<TickResult> {
    const riskState = await this.useCases.guardRisk.execute();
    logger.debug(`bot.tick tick=${tick} riskState=${riskState}`);

    if (riskState === "EMERGENCY_STOP") {
      logger.warn(`bot.stopping reason=emergency_stop tick=${tick}`);
      return "stop";
    }

    if (riskState === "OK") {
      await this.useCases.refreshQuotes.execute();
      this.quotedCount += 2;
    }

    await this.drainEventTasks();
    await this.useCases.reduceInventory.executeIfNeeded();
    return this.advanceMarketFeed(tick);
  }

  private async advanceMarketFeed(tick: number): Promise<TickResult> {
    if (this.marketFeed.advance === undefined) {
      return "continue";
    }

    if (await this.marketFeed.advance()) {
      return "continue";
    }

    logger.info(`bot.stopping reason=market_feed_exhausted tick=${tick}`);
    return "stop";
  }

  private hasReachedMaxTicks(ticks: number, maxTicks?: number): boolean {
    if (maxTicks === undefined || ticks < maxTicks) {
      return false;
    }

    logger.info(`bot.stopping reason=max_ticks tick=${ticks}`);
    return true;
  }

  private async cleanup(): Promise<unknown> {
    let closePositionError: unknown;
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
    await this.drainEventTasks();
    await this.orderGateway.dispose?.();
    if (closePositionError === undefined) {
      logger.info(`bot.cleanup_complete quotedCount=${this.quotedCount}`);
    } else {
      logger.error(`bot.cleanup_failed quotedCount=${this.quotedCount} closePositionFailed=true`);
    }
    return closePositionError;
  }

  private async recordOhlcv(snapshot: MarketSnapshot): Promise<void> {
    await this.telemetry?.recordMarketSnapshot(snapshot);
    await this.useCases.recordOhlcv.execute(snapshot).catch((err) => {
      logger.warn(
        `bot.market_snapshot_record_failed market=${snapshot.market} ts=${snapshot.timestamp} error=${String(err)}`,
      );
      void this.telemetry?.recordRuntimeHealth(
        "warn",
        "market_snapshot_record_failed",
        String(err),
        { market: snapshot.market, ts: snapshot.timestamp },
      );
    });
  }

  private enqueueEventTask(task: () => Promise<void>): void {
    this.eventTasks = this.eventTasks.then(task, task);
  }

  private async drainEventTasks(): Promise<void> {
    await this.eventTasks;
  }
}
