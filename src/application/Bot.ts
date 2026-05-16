import { match, P } from "ts-pattern";
import type { Fill } from "../domain/types/Fill.ts";
import { isFlatPositionQty } from "../domain/types/Position.ts";
import type { IMarketFeed, MarketSnapshot } from "../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../domain/ports/IOrderGateway.ts";
import {
  isRecoverableVenueError,
  type RecoverableVenueError,
} from "../domain/ports/RecoverableVenueError.ts";
import { stringifyError } from "../utils/errors.ts";
import { LOG_ORANGE, LOG_RESET, logger } from "../utils/logger.ts";
import type { MetricsRecorder } from "./services/MetricsRecorder.ts";
import type { RiskDecision, RiskState } from "./usecases/GuardRiskUseCase.ts";
import type { PositionSyncResult } from "./usecases/SyncPositionUseCase.ts";

interface UseCases {
  guardRisk: { execute(): Promise<RiskState | RiskDecision> };
  initializePosition?: { execute(): Promise<void> };
  syncPosition?: { execute(): Promise<PositionSyncResult> };
  quotingCycle: { execute(): Promise<void> };
  updatePositionOnFill: { execute(fill: Fill): Promise<void> };
  recordOhlcv: { execute(snapshot: MarketSnapshot): Promise<void> };
  reduceInventory: { executeIfNeeded(): Promise<boolean> };
  closePosition: { execute(): Promise<void> };
}

type TickResult = "continue" | "stop";
type RiskTickAction = "quote" | "pause_quoting" | "stop";
type ShutdownClosePositionPolicy = "always" | "emergency_only";
type RuntimeDisposable = { start?: () => void; stop: () => void };

interface BotStartOptions {
  maxTicks?: number;
  signal?: AbortSignal;
}

interface BotOptions {
  closePositionPolicy: ShutdownClosePositionPolicy;
  eventTaskDrainTimeoutMs?: number;
  positionSyncIntervalMs?: number;
  runtimeDisposables?: readonly RuntimeDisposable[];
}

export class Bot {
  private running = false;
  private quotedCount = 0;
  private stopRequested = false;
  private emergencyStopRequested = false;
  private eventTasks: Promise<void> = Promise.resolve();
  private pauseQuoteCancelCompleted = false;
  private lastPositionSyncAtMs = 0;
  private marketFeedConnected = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly useCases: UseCases,
    private readonly marketFeed: IMarketFeed,
    private readonly orderGateway: IOrderGateway,
    private readonly intervalMs: number,
    private readonly metrics?: MetricsRecorder,
    private readonly options: BotOptions = { closePositionPolicy: "always" },
  ) {}

  async start(maxTicksOrOptions?: number | BotStartOptions): Promise<void> {
    const startOptions = normalizeStartOptions(maxTicksOrOptions);
    this.resetRunState();
    const removeAbortListener = this.watchStopSignal(startOptions.signal);
    let shouldCleanup = false;
    let runError: unknown;
    let closePositionError: unknown;
    logger.info(
      `[application] Bot | START | intervalMs=${this.intervalMs} maxTicks=${startOptions.maxTicks ?? "unbounded"}`,
    );

    try {
      await this.metrics?.start(Date.now());
      if (!this.wasStopRequested()) {
        await this.connectAndSubscribe();
        shouldCleanup = true;
        this.startRuntimeDisposables();
        await this.runLoop(startOptions.maxTicks, startOptions.signal);
      }
    } catch (err) {
      if (this.wasStopRequested()) {
        logger.warn(
          `[application] Bot | RUN_ERROR_IGNORED_AFTER_STOP | error=${stringifyError(err)}`,
        );
      } else {
        runError = err;
        await this.metrics?.recordRuntimeHealth("error", "runtime_error", stringifyError(err));
      }
    } finally {
      removeAbortListener();
      if (shouldCleanup || this.marketFeedConnected) {
        closePositionError = await this.cleanup();
      } else {
        closePositionError = this.stopRuntimeDisposables();
        this.running = false;
      }
      const metricsWithDrain = this.metrics as
        | (MetricsRecorder & { drainAndStop?: () => Promise<void> })
        | undefined;
      if (metricsWithDrain?.drainAndStop !== undefined) {
        await metricsWithDrain.drainAndStop();
      }
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

  private resetRunState(): void {
    this.running = true;
    this.quotedCount = 0;
    this.stopRequested = false;
    this.emergencyStopRequested = false;
    this.pauseQuoteCancelCompleted = false;
    this.lastPositionSyncAtMs = 0;
    this.marketFeedConnected = false;
    this.eventTasks = Promise.resolve();
    this.unsubscribers.splice(0);
  }

  stop(reason = "requested"): void {
    this.requestStop(reason);
  }

  private requestStop(reason = "requested"): boolean {
    if (this.stopRequested) {
      return false;
    }
    this.stopRequested = true;
    this.running = false;
    logger.info(`[application] Bot | STOP_REQUESTED | reason=${reason}`);
    return true;
  }

  private watchStopSignal(signal?: AbortSignal): () => void {
    if (signal === undefined) {
      return () => {};
    }

    const requestStopFromSignal = () => {
      this.requestStop(stopReasonFromSignal(signal));
    };

    if (signal.aborted) {
      requestStopFromSignal();
      return () => {};
    }

    signal.addEventListener("abort", requestStopFromSignal, { once: true });
    return () => signal.removeEventListener("abort", requestStopFromSignal);
  }

  private isRunning(): boolean {
    return this.running;
  }

  private wasStopRequested(): boolean {
    return this.stopRequested;
  }

  private async connectAndSubscribe(): Promise<void> {
    await this.marketFeed.connect();
    this.marketFeedConnected = true;
    logger.info("[application] Bot | MARKET_FEED_CONNECTED |");
    await this.syncInitialFills();
    await this.useCases.initializePosition?.execute();
    this.unsubscribers.push(
      this.marketFeed.subscribe((snapshot) => {
        this.enqueueEventTask(async () => this.recordOhlcv(snapshot));
      }),
      this.orderGateway.subscribeFills((fill) => {
        logger.info(
          `[application] Bot | ${LOG_ORANGE}FILL_RECEIVED${LOG_RESET} | market=${fill.market} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
        );
        this.enqueueEventTask(async () => {
          await this.metrics?.recordFill(fill);
          if (!this.usesAuthoritativePosition()) {
            await this.useCases.updatePositionOnFill.execute(fill);
          }
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
    logger.info("[application] Bot | MARKET_SNAPSHOT_SUBSCRIPTION_ACTIVE |");
    logger.info("[application] Bot | FILL_SUBSCRIPTION_ACTIVE |");
    await this.recordOhlcv(await this.marketFeed.getSnapshot());
  }

  private async syncInitialFills(): Promise<void> {
    if (this.orderGateway.syncFills === undefined) {
      return;
    }

    await this.orderGateway.syncFills().catch(async (error) => {
      const errorMessage = recoverableRuntimeErrorMessageOrThrow(error);
      logger.warn(`[application] Bot | INITIAL_SYNC_TRANSIENT_ERROR | error=${errorMessage}`);
      await this.metrics?.recordRuntimeHealth("warn", "initial_sync_transient_error", errorMessage);
    });
  }

  private async runLoop(maxTicks?: number, signal?: AbortSignal): Promise<void> {
    if (maxTicks !== undefined && maxTicks <= 0) {
      logger.info("[application] Bot | STOPPING | reason=max_ticks tick=0");
      return;
    }

    let ticks = 0;

    while (this.isRunning()) {
      const tick = ticks + 1;
      const tickResult = await this.runTickOrContinueOnTransientError(tick);
      ticks = tick;

      if (tickResult === "stop" || this.hasReachedMaxTicks(ticks, maxTicks) || !this.isRunning()) {
        break;
      }

      await this.sleepUntilNextTick(signal);
    }
  }

  private async runTickOrContinueOnTransientError(tick: number): Promise<TickResult> {
    try {
      return await this.runTick(tick);
    } catch (error) {
      const errorMessage = recoverableRuntimeErrorMessageOrThrow(error);
      logger.warn(`[application] Bot | TICK_TRANSIENT_ERROR | tick=${tick} error=${errorMessage}`);
      await this.metrics?.recordRuntimeHealth("warn", "transient_tick_error", errorMessage, {
        tick,
      });
      return "continue";
    }
  }

  private async runTick(tick: number): Promise<TickResult> {
    const riskDecision = await this.useCases.guardRisk.execute();
    const riskState = riskStateOf(riskDecision);
    logger.debug(`[application] Bot | TICK | tick=${tick} riskState=${riskState}`);
    const riskAction = await this.handleRiskGate(tick, riskDecision, riskState);

    return await match(riskAction)
      .with("stop", () => "stop" as const)
      .otherwise(async (activeRiskAction) => {
        await this.drainEventTasks();
        await this.syncPositionIfDue();
        const didReduceInventory = await this.useCases.reduceInventory.executeIfNeeded();
        await match<[RiskTickAction, boolean], Promise<void>>([
          activeRiskAction,
          didReduceInventory,
        ])
          .with(["quote", false], async () => {
            await this.useCases.quotingCycle.execute();
            this.quotedCount += 2;
          })
          .otherwise(async () => {});
        return this.advanceMarketFeed(tick);
      });
  }

  private async handleRiskGate(
    tick: number,
    riskDecision: RiskState | RiskDecision,
    riskState: RiskState,
  ): Promise<RiskTickAction> {
    return await match<RiskState, Promise<RiskTickAction> | RiskTickAction>(riskState)
      .with("EMERGENCY_STOP", async () => {
        await this.metrics?.recordRuntimeHealth(
          "error",
          "risk_gate_emergency_stop",
          "Risk gate requested emergency stop",
          riskRuntimeSummary(tick, riskDecision),
        );
        logger.warn(`[application] Bot | STOPPING | reason=emergency_stop tick=${tick}`);
        this.emergencyStopRequested = true;
        return "stop" as const;
      })
      .with("PAUSE_QUOTING", async () => {
        await this.metrics?.recordRuntimeHealth(
          "warn",
          "risk_gate_pause_quoting",
          "Risk gate paused quoting cycle",
          riskRuntimeSummary(tick, riskDecision),
        );
        await this.cancelOpenOrdersForPause(tick, riskDecision);
        return "pause_quoting" as const;
      })
      .with("OK", () => {
        this.pauseQuoteCancelCompleted = false;
        return "quote";
      })
      .exhaustive();
  }

  private async syncPositionIfDue(): Promise<void> {
    if (this.useCases.syncPosition === undefined) {
      return;
    }
    const nowMs = Date.now();
    const intervalMs = this.options.positionSyncIntervalMs ?? 2_000;
    if (this.lastPositionSyncAtMs !== 0 && nowMs - this.lastPositionSyncAtMs < intervalMs) {
      return;
    }

    this.lastPositionSyncAtMs = nowMs;
    try {
      const result = await this.useCases.syncPosition.execute();
      if (result.synced && !isFlatPositionQty(result.deltaQty)) {
        await this.metrics?.recordRuntimeHealth(
          "info",
          "position_sync_corrected",
          "Live position was reconciled from exchange account state",
          {
            previousQty: result.previous.qty,
            currentQty: result.current.qty,
            deltaQty: result.deltaQty,
          },
        );
      }
    } catch (error) {
      logger.warn(`[application] Bot | POSITION_SYNC_FAILED | error=${stringifyError(error)}`);
      await this.metrics?.recordRuntimeHealth(
        "warn",
        "position_sync_failed",
        stringifyError(error),
      );
    }
  }

  private usesAuthoritativePosition(): boolean {
    return this.orderGateway.getPosition !== undefined;
  }

  private async advanceMarketFeed(tick: number): Promise<TickResult> {
    if (this.marketFeed.advance === undefined) {
      return "continue";
    }

    if (await this.marketFeed.advance()) {
      return "continue";
    }

    logger.info(`[application] Bot | STOPPING | reason=market_feed_exhausted tick=${tick}`);
    return "stop";
  }

  private hasReachedMaxTicks(ticks: number, maxTicks?: number): boolean {
    if (maxTicks === undefined || ticks < maxTicks) {
      return false;
    }

    logger.info(`[application] Bot | STOPPING | reason=max_ticks tick=${ticks}`);
    return true;
  }

  private async cleanup(): Promise<unknown> {
    let closePositionError: unknown;
    const recordCleanupFailure = (event: string, err: unknown) => {
      closePositionError ??= err;
      logger.error(`[application] Bot | ${event} | error=${stringifyError(err)}`);
    };
    const runCleanupStep = async (event: string, step: () => void | Promise<void>) => {
      await Promise.resolve()
        .then(step)
        .catch((err) => recordCleanupFailure(event, err));
    };
    this.running = false;
    logger.info("[application] Bot | CLEANUP_STARTED |");
    if (this.orderGateway.stopBackgroundSync !== undefined) {
      await runCleanupStep("CLEANUP_STOP_BACKGROUND_SYNC_FAILED", (): void | Promise<void> =>
        this.orderGateway.stopBackgroundSync?.(),
      );
    }
    logger.info("[application] Bot | CLEANUP_CANCEL_ALL_STARTED |");
    await this.orderGateway
      .cancelAll()
      .catch((err) =>
        logger.error(
          `[application] Bot | CLEANUP_CANCEL_ALL_FAILED | error=${stringifyError(err)}`,
        ),
      );
    logger.info("[application] Bot | CLEANUP_CANCEL_ALL_COMPLETE |");
    await this.syncCleanupFills("after_cancel_all");
    if (this.shouldClosePositionOnCleanup()) {
      logger.info("[application] Bot | CLEANUP_CLOSE_POSITION_STARTED |");
      await this.useCases.closePosition.execute().catch((err) => {
        closePositionError = err;
        logger.error(
          `[application] Bot | CLEANUP_CLOSE_POSITION_FAILED | error=${stringifyError(err)}`,
        );
      });
      if (closePositionError === undefined) {
        logger.info("[application] Bot | CLEANUP_CLOSE_POSITION_COMPLETE |");
      }
      await this.syncCleanupFills("after_close_position");
    } else {
      logger.info(
        `[application] Bot | CLEANUP_CLOSE_POSITION_SKIPPED | policy=${this.options.closePositionPolicy} emergencyStop=${this.emergencyStopRequested}`,
      );
    }
    await runCleanupStep("CLEANUP_DISCONNECT_FAILED", async () => {
      await this.marketFeed.disconnect();
    });
    this.marketFeedConnected = false;
    closePositionError ??= this.stopRuntimeDisposables();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch (err) {
        recordCleanupFailure("CLEANUP_UNSUBSCRIBE_FAILED", err);
      }
    }
    await runCleanupStep("CLEANUP_EVENT_TASK_DRAIN_FAILED", async () => {
      await this.drainEventTasks();
    });
    if (this.orderGateway.dispose !== undefined) {
      await runCleanupStep("CLEANUP_DISPOSE_FAILED", (): void | Promise<void> =>
        this.orderGateway.dispose?.(),
      );
    }
    if (closePositionError === undefined) {
      logger.info(`[application] Bot | CLEANUP_COMPLETE | quotedCount=${this.quotedCount}`);
    } else {
      logger.error(
        `[application] Bot | CLEANUP_FAILED | quotedCount=${this.quotedCount} closePositionFailed=true`,
      );
    }
    return closePositionError;
  }

  private shouldClosePositionOnCleanup(): boolean {
    return this.options.closePositionPolicy === "always" || this.emergencyStopRequested;
  }

  private startRuntimeDisposables(): void {
    for (const disposable of this.options.runtimeDisposables ?? []) {
      disposable.start?.();
    }
  }

  private stopRuntimeDisposables(): unknown {
    let firstError: unknown;
    for (const disposable of this.options.runtimeDisposables ?? []) {
      try {
        disposable.stop();
      } catch (error) {
        firstError ??= error;
        logger.error(
          `[application] Bot | RUNTIME_DISPOSABLE_STOP_FAILED | error=${stringifyError(error)}`,
        );
      }
    }
    return firstError;
  }

  private async cancelOpenOrdersForPause(
    tick: number,
    riskDecision: RiskState | RiskDecision,
  ): Promise<void> {
    if (this.pauseQuoteCancelCompleted) {
      return;
    }

    const startedAt = Date.now();
    const summary = riskRuntimeSummary(tick, riskDecision);
    try {
      await this.orderGateway.cancelAll();
      this.pauseQuoteCancelCompleted = true;
      const latencyMs = Date.now() - startedAt;
      logger.warn(
        `[application] Bot | PAUSE_QUOTE_CANCEL_ALL | tick=${tick} latencyMs=${latencyMs}`,
      );
      await this.metrics?.recordRuntimeHealth(
        "warn",
        "pause_quote_cancel_all",
        "Cancelled open orders while quoting cycle is paused",
        { ...summary, latencyMs, success: true },
      );
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      logger.error(
        `[application] Bot | PAUSE_QUOTE_CANCEL_ALL_FAILED | tick=${tick} error=${stringifyError(error)}`,
      );
      await this.metrics?.recordRuntimeHealth(
        "error",
        "pause_quote_cancel_all",
        "Failed to cancel open orders while quoting cycle is paused",
        { ...summary, latencyMs, success: false, error: stringifyError(error) },
      );
    }
  }

  private async syncCleanupFills(phase: string): Promise<void> {
    await this.orderGateway.syncFills?.().catch(async (error) => {
      logger.warn(
        `[application] Bot | CLEANUP_SYNC_FILLS_FAILED | phase=${phase} error=${stringifyError(error)}`,
      );
      await this.metrics?.recordRuntimeHealth(
        "warn",
        "cleanup_sync_fills_failed",
        stringifyError(error),
        {
          phase,
        },
      );
    });
  }

  private async recordOhlcv(snapshot: MarketSnapshot): Promise<void> {
    await this.metrics?.recordMarketSnapshot(snapshot);
    await this.useCases.recordOhlcv.execute(snapshot).catch((err) => {
      logger.warn(
        `[application] Bot | MARKET_SNAPSHOT_RECORD_FAILED | market=${snapshot.market} ts=${snapshot.timestamp} error=${stringifyError(err)}`,
      );
      void this.metrics?.recordRuntimeHealth(
        "warn",
        "market_snapshot_record_failed",
        stringifyError(err),
        {
          market: snapshot.market,
          ts: snapshot.timestamp,
        },
      );
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
    logger.warn(`[application] Bot | EVENT_TASKS_DRAIN_TIMEOUT | timeoutMs=${timeoutMs}`);
    await this.metrics?.recordRuntimeHealth(
      "warn",
      "event_tasks_drain_timeout",
      `event tasks did not drain within ${timeoutMs}ms`,
      { timeoutMs },
    );
    void pendingTasks.catch((error) => {
      logger.warn(
        `[application] Bot | EVENT_TASKS_DETACHED_FAILED | error=${stringifyError(error)}`,
      );
    });
    if (this.eventTasks === pendingTasks) {
      this.eventTasks = Promise.resolve();
    }
  }

  private eventTaskDrainTimeoutMs(): number {
    return this.options.eventTaskDrainTimeoutMs ?? Math.max(1_000, this.intervalMs);
  }

  private async sleepUntilNextTick(signal?: AbortSignal): Promise<void> {
    if (signal === undefined) {
      await Bun.sleep(this.intervalMs);
      return;
    }
    if (signal.aborted) {
      return;
    }

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, this.intervalMs);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}

function normalizeStartOptions(maxTicksOrOptions?: number | BotStartOptions): BotStartOptions {
  return match(maxTicksOrOptions)
    .with(
      P.union(
        P.when((value): value is number => typeof value === "number"),
        undefined,
      ),
      (maxTicks) => ({ maxTicks }),
    )
    .otherwise((options) => options);
}

function recoverableRuntimeErrorMessageOrThrow(error: unknown): string {
  const recoverableError = directRecoverableVenueError(error);
  if (recoverableError === null) {
    throw error;
  }
  return stringifyError(recoverableError.cause ?? recoverableError);
}

function directRecoverableVenueError(error: unknown): RecoverableVenueError | null {
  if (isRecoverableVenueError(error)) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const cause = (error as { cause?: unknown }).cause;
    if (isRecoverableVenueError(cause)) {
      return cause;
    }
  }

  return null;
}

function stopReasonFromSignal(signal: AbortSignal): string {
  const { reason } = signal;
  return match(reason)
    .with(
      P.when((reason): reason is string => typeof reason === "string"),
      (reason) => reason,
    )
    .with(
      P.when((reason): reason is Error => reason instanceof Error),
      (reason) => reason.message,
    )
    .with(undefined, () => "aborted")
    .otherwise((reason) => String(reason));
}

function riskStateOf(decision: RiskState | RiskDecision): RiskState {
  return match(decision)
    .with(
      P.when((decision): decision is RiskState => typeof decision === "string"),
      (decision) => decision,
    )
    .otherwise((decision) => decision.state);
}

function riskRuntimeSummary(
  tick: number,
  decision: RiskState | RiskDecision,
): Record<string, unknown> {
  return match(decision)
    .with(
      P.when((decision): decision is RiskState => typeof decision === "string"),
      (decision) => ({
        tick,
        riskState: decision,
      }),
    )
    .otherwise((decision) => {
      const { state, ...details } = decision;
      return { tick, riskState: state, ...details };
    });
}
