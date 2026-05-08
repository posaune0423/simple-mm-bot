import type { Fill } from "../domain/entities/Fill.ts";
import type { IMarketFeed, MarketSnapshot } from "../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../domain/ports/IOrderGateway.ts";
import { logger } from "../utils/logger.ts";
import type { MetricsRecorder } from "./MetricsRecorder.ts";
import type { RiskState } from "./usecases/GuardRiskUseCase.ts";

interface UseCases {
  guardRisk: { execute(): Promise<RiskState> };
  initializePosition?: { execute(): Promise<void> };
  refreshQuotes: { execute(): Promise<void> };
  updatePositionOnFill: { execute(fill: Fill): Promise<void> };
  recordOhlcv: { execute(snapshot: MarketSnapshot): Promise<void> };
  reduceInventory: { executeIfNeeded(): Promise<boolean> };
  closePosition: { execute(): Promise<void> };
}

type TickResult = "continue" | "stop";
type ShutdownClosePositionPolicy = "always" | "emergency_only";

interface BotOptions {
  closePositionPolicy: ShutdownClosePositionPolicy;
  eventTaskDrainTimeoutMs?: number;
}

type ErrorLike = {
  name?: unknown;
  status?: unknown;
  message?: unknown;
  response?: unknown;
};

export class Bot {
  private running = false;
  private quotedCount = 0;
  private stopRequested = false;
  private emergencyStopRequested = false;
  private eventTasks: Promise<void> = Promise.resolve();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly useCases: UseCases,
    private readonly marketFeed: IMarketFeed,
    private readonly orderGateway: IOrderGateway,
    private readonly intervalMs: number,
    private readonly metrics?: MetricsRecorder,
    private readonly options: BotOptions = { closePositionPolicy: "always" },
  ) {}

  async start(maxTicks?: number): Promise<void> {
    this.running = true;
    this.stopRequested = false;
    let runError: unknown;
    let closePositionError: unknown;
    logger.info(`bot.start intervalMs=${this.intervalMs} maxTicks=${maxTicks ?? "unbounded"}`);

    try {
      await this.metrics?.start(Date.now());
      await this.connectAndSubscribe();
      await this.runLoop(maxTicks);
    } catch (err) {
      if (this.wasStopRequested()) {
        logger.warn(`bot.run_error_ignored_after_stop error=${String(err)}`);
      } else {
        runError = err;
        await this.metrics?.recordRuntimeHealth("error", "runtime_error", String(err));
      }
    } finally {
      closePositionError = await this.cleanup();
      await this.metrics?.finish(
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
  }

  stop(): void {
    this.stopRequested = true;
    this.running = false;
  }

  private isRunning(): boolean {
    return this.running;
  }

  private wasStopRequested(): boolean {
    return this.stopRequested;
  }

  private async connectAndSubscribe(): Promise<void> {
    await this.marketFeed.connect();
    logger.info("bot.market_feed_connected");
    await this.orderGateway.syncFills?.();
    await this.useCases.initializePosition?.execute();
    this.unsubscribers.push(
      this.marketFeed.subscribe((snapshot) => {
        this.enqueueEventTask(async () => this.recordOhlcv(snapshot));
      }),
      this.orderGateway.subscribeFills((fill) => {
        logger.info(
          `bot.fill_received market=${fill.market} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
        );
        this.enqueueEventTask(async () => {
          await this.metrics?.recordFill(fill);
          await this.useCases.updatePositionOnFill.execute(fill);
        });
      }),
    );
    if (this.orderGateway.subscribeOrderEvents !== undefined) {
      this.unsubscribers.push(
        this.orderGateway.subscribeOrderEvents((event) => {
          this.enqueueEventTask(async () => {
            await this.metrics?.recordOrder(event);
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
      const tickResult = await this.runTickSafely(tick);
      ticks = tick;

      if (tickResult === "stop" || this.hasReachedMaxTicks(ticks, maxTicks) || !this.isRunning()) {
        break;
      }

      await Bun.sleep(this.intervalMs);
    }
  }

  private async runTickSafely(tick: number): Promise<TickResult> {
    try {
      return await this.runTick(tick);
    } catch (error) {
      if (!isTransientBulkError(error)) {
        throw error;
      }
      logger.warn(`bot.tick_transient_error tick=${tick} error=${String(error)}`);
      await this.metrics?.recordRuntimeHealth("warn", "transient_tick_error", String(error), {
        tick,
      });
      return "continue";
    }
  }

  private async runTick(tick: number): Promise<TickResult> {
    const riskState = await this.useCases.guardRisk.execute();
    logger.debug(`bot.tick tick=${tick} riskState=${riskState}`);

    if (riskState === "EMERGENCY_STOP") {
      logger.warn(`bot.stopping reason=emergency_stop tick=${tick}`);
      this.emergencyStopRequested = true;
      return "stop";
    }

    await this.drainEventTasks();
    const didReduceInventory = await this.useCases.reduceInventory.executeIfNeeded();
    if (riskState === "OK" && !didReduceInventory) {
      await this.useCases.refreshQuotes.execute();
      this.quotedCount += 2;
    }
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
    await this.orderGateway.stopBackgroundSync?.();
    await this.orderGateway
      .cancelAll()
      .catch((err) => logger.error(`bot.cleanup.cancel_all_failed: ${err}`));
    if (this.shouldClosePositionOnCleanup()) {
      await this.useCases.closePosition.execute().catch((err) => {
        closePositionError = err;
        logger.error(`bot.cleanup.close_position_failed: ${err}`);
      });
    }
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

  private shouldClosePositionOnCleanup(): boolean {
    return this.options.closePositionPolicy === "always" || this.emergencyStopRequested;
  }

  private async recordOhlcv(snapshot: MarketSnapshot): Promise<void> {
    await this.metrics?.recordMarketSnapshot(snapshot);
    await this.useCases.recordOhlcv.execute(snapshot).catch((err) => {
      logger.warn(
        `bot.market_snapshot_record_failed market=${snapshot.market} ts=${snapshot.timestamp} error=${String(err)}`,
      );
      void this.metrics?.recordRuntimeHealth("warn", "market_snapshot_record_failed", String(err), {
        market: snapshot.market,
        ts: snapshot.timestamp,
      });
    });
  }

  private enqueueEventTask(task: () => Promise<void>): void {
    this.eventTasks = this.eventTasks.then(task, task);
  }

  private async drainEventTasks(): Promise<void> {
    const pendingTasks = this.eventTasks;
    const result = await Promise.race([
      pendingTasks.then(() => "completed" as const),
      Bun.sleep(this.eventTaskDrainTimeoutMs()).then(() => "timeout" as const),
    ]);

    if (result === "completed") {
      return;
    }

    const timeoutMs = this.eventTaskDrainTimeoutMs();
    logger.warn(`bot.event_tasks_drain_timeout timeoutMs=${timeoutMs}`);
    await this.metrics?.recordRuntimeHealth(
      "warn",
      "event_tasks_drain_timeout",
      `event tasks did not drain within ${timeoutMs}ms`,
      { timeoutMs },
    );
    void pendingTasks.catch((error) => {
      logger.warn(`bot.event_tasks_detached_failed error=${String(error)}`);
    });
    if (this.eventTasks === pendingTasks) {
      this.eventTasks = Promise.resolve();
    }
  }

  private eventTaskDrainTimeoutMs(): number {
    return this.options.eventTaskDrainTimeoutMs ?? Math.max(1_000, this.intervalMs);
  }
}

function isTransientBulkError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const errorLike = error as ErrorLike;
    const status = toHttpStatus(errorLike);
    if (status === 408) {
      return true;
    }
    if (errorLike.name === "BulkTimeoutError") {
      return true;
    }
  }

  const message = String(error);
  return message.includes("HTTP error 408") || message.includes("HTTP request timed out");
}

function toHttpStatus(errorLike: ErrorLike): number | undefined {
  const maybeStatus = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) ? parsed : undefined;
    }
    return undefined;
  };

  const directStatus = maybeStatus(errorLike.status);
  if (directStatus !== undefined) {
    return directStatus;
  }

  if (
    errorLike.response === undefined ||
    errorLike.response === null ||
    typeof errorLike.response !== "object"
  ) {
    return undefined;
  }

  const responseStatus = maybeStatus((errorLike.response as { status?: unknown }).status);
  return responseStatus;
}
