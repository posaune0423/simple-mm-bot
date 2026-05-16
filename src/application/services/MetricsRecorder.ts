import { randomUUID } from "node:crypto";
import { match, P } from "ts-pattern";

import type { Fill } from "../../domain/types/Fill.ts";
import type { ExposureIntent, Quote } from "../../domain/types/LegacyQuote.ts";
import type { OrderSide } from "../../domain/types/Order.ts";
import type { MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import type {
  CapitalMode,
  IMetricsRepository,
  OrderLifecycleEventFact,
  SubmittedOrderFact,
  TradingRunFact,
} from "../../domain/ports/IMetricsRepository.ts";
import type { OrderGatewayEvent } from "../../domain/ports/IOrderGateway.ts";
import type { AppMode } from "../../config.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

interface MetricsRecorderOptions {
  runId?: string;
  mode: AppMode;
  venue: string;
  capitalMode: CapitalMode;
  market: string;
  strategyName: string;
  configJson: unknown;
  gitSha?: string;
  gitDirty: boolean;
  horizonsSec?: ReadonlyArray<5 | 30 | 60 | 300>;
}

interface PnlPosition {
  qty: number;
  avgEntry: number;
}

type SubmittedOrderState = SubmittedOrderFact;
type MetricsOperationPriority = "critical" | "normal";
type MetricsOperationType =
  | "account_state"
  | "order_lifecycle"
  | "orderbook_snapshot"
  | "quote_decision"
  | "runtime_health"
  | "submitted_order"
  | "trade_fill"
  | "ohlcv";

interface MetricsWriteOperation {
  type: MetricsOperationType;
  priority: MetricsOperationPriority;
  run: () => Promise<void>;
}

interface MetricsBufferOptions {
  normalCapacity?: number;
  criticalCapacity?: number;
}

interface MetricsDropSummary {
  dropped: Partial<Record<MetricsOperationType, number>>;
  criticalBacklogExceeded: number;
}

export class MetricsBuffer {
  private readonly normalCapacity: number;
  private readonly criticalCapacity: number;
  private readonly normalQueue: MetricsWriteOperation[] = [];
  private readonly criticalQueue: MetricsWriteOperation[] = [];
  private readonly dropped = new Map<MetricsOperationType, number>();
  private criticalBacklogExceeded = 0;

  constructor(options: MetricsBufferOptions = {}) {
    this.normalCapacity = options.normalCapacity ?? 10_000;
    this.criticalCapacity = options.criticalCapacity ?? 10_000;
  }

  enqueue(operation: MetricsWriteOperation): void {
    if (operation.priority === "critical") {
      this.enqueueCritical(operation);
      return;
    }
    this.enqueueNormal(operation);
  }

  drainBatch(maxSize: number): MetricsWriteOperation[] {
    const batch: MetricsWriteOperation[] = [];
    while (batch.length < maxSize && this.criticalQueue.length > 0) {
      const operation = this.criticalQueue.shift();
      if (operation !== undefined) {
        batch.push(operation);
      }
    }
    while (batch.length < maxSize && this.normalQueue.length > 0) {
      const operation = this.normalQueue.shift();
      if (operation !== undefined) {
        batch.push(operation);
      }
    }
    return batch;
  }

  pendingCount(): number {
    return this.criticalQueue.length + this.normalQueue.length;
  }

  criticalPendingCount(): number {
    return this.criticalQueue.length;
  }

  takeDropSummary(): MetricsDropSummary {
    const dropped = Object.fromEntries(this.dropped) as Partial<
      Record<MetricsOperationType, number>
    >;
    this.dropped.clear();
    const criticalBacklogExceeded = this.criticalBacklogExceeded;
    this.criticalBacklogExceeded = 0;
    return { dropped, criticalBacklogExceeded };
  }

  private enqueueNormal(operation: MetricsWriteOperation): void {
    if (this.normalQueue.length >= this.normalCapacity) {
      this.dropOldestNormal();
    }
    if (this.normalQueue.length < this.normalCapacity) {
      this.normalQueue.push(operation);
      return;
    }
    this.recordDrop(operation.type);
  }

  private enqueueCritical(operation: MetricsWriteOperation): void {
    if (this.criticalQueue.length >= this.criticalCapacity) {
      this.criticalBacklogExceeded += 1;
      logger.error(
        `[application] MetricsBuffer | CRITICAL_BACKLOG_EXCEEDED | type=${operation.type} criticalPending=${this.criticalQueue.length} normalPending=${this.normalQueue.length}`,
      );
      if (this.normalQueue.length > 0) {
        this.dropOldestNormal();
        this.criticalQueue.push(operation);
        return;
      }
      if (this.criticalQueue.length >= this.criticalCapacity) {
        const dropped = this.criticalQueue.shift();
        if (dropped !== undefined) {
          this.recordDrop(dropped.type);
        }
      }
    }
    this.criticalQueue.push(operation);
  }

  private dropOldestNormal(): void {
    const dropped = this.normalQueue.shift();
    if (dropped !== undefined) {
      this.recordDrop(dropped.type);
    }
  }

  private recordDrop(type: MetricsOperationType): void {
    this.dropped.set(type, (this.dropped.get(type) ?? 0) + 1);
  }
}

interface MetricsFlushLoopOptions {
  batchSize?: number;
  drainTimeoutMs?: number;
  intervalMs?: number;
  onDropSummary?: (summary: MetricsDropSummary) => Promise<void>;
}

export class MetricsFlushLoop {
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;
  private activeFlush: Promise<void> | undefined;
  private inFlightCount = 0;
  private readonly batchSize: number;
  private readonly drainTimeoutMs: number;
  private readonly intervalMs: number;

  constructor(
    private readonly buffer: MetricsBuffer,
    private readonly options: MetricsFlushLoopOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 500;
    this.drainTimeoutMs = options.drainTimeoutMs ?? 15_000;
    this.intervalMs = options.intervalMs ?? 500;
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flushOnce();
    }, this.intervalMs);
  }

  async flushOnce(): Promise<void> {
    if (this.flushing) {
      return;
    }
    this.activeFlush = this.runFlushOnce();
    await this.activeFlush;
  }

  private async runFlushOnce(): Promise<void> {
    this.flushing = true;
    try {
      const batch = this.buffer.drainBatch(this.batchSize);
      this.inFlightCount = batch.length;
      for (const operation of batch) {
        try {
          await operation.run();
        } catch (error) {
          logger.warn(
            `[application] MetricsFlushLoop | FLUSH_FAILED | type=${operation.type} error=${stringifyError(error)}`,
          );
        } finally {
          this.inFlightCount -= 1;
        }
      }
      await this.emitDropSummary();
    } finally {
      this.flushing = false;
      this.activeFlush = undefined;
    }
  }

  async drainAndStop(timeoutMs = this.drainTimeoutMs): Promise<void> {
    this.stopTimer();
    const startedAt = Date.now();
    while (this.hasPendingWork() && Date.now() - startedAt < timeoutMs) {
      if (this.activeFlush !== undefined) {
        await this.activeFlush;
        continue;
      }
      await this.flushOnce();
    }
    if (this.activeFlush !== undefined) {
      await this.activeFlush;
    }
    await this.emitDropSummary();
    const pending = this.buffer.pendingCount() + this.inFlightCount;
    if (pending > 0) {
      logger.warn(
        `[application] MetricsFlushLoop | DRAIN_TIMEOUT | timeoutMs=${timeoutMs} pending=${pending} criticalPending=${this.buffer.criticalPendingCount()}`,
      );
    }
  }

  private hasPendingWork(): boolean {
    return this.buffer.pendingCount() > 0 || this.inFlightCount > 0 || this.flushing;
  }

  private stopTimer(): void {
    if (this.timer === undefined) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async emitDropSummary(): Promise<void> {
    const summary = this.buffer.takeDropSummary();
    const droppedTotal = Object.values(summary.dropped).reduce((sum, count) => sum + count, 0);
    if (droppedTotal === 0 && summary.criticalBacklogExceeded === 0) {
      return;
    }
    logger.warn(
      `[application] MetricsFlushLoop | BUFFER_DROPPED | dropped=${JSON.stringify(summary.dropped)} criticalBacklogExceeded=${summary.criticalBacklogExceeded}`,
    );
    await this.options.onDropSummary?.(summary).catch((error) => {
      logger.warn(
        `[application] MetricsFlushLoop | DROP_SUMMARY_RECORD_FAILED | error=${stringifyError(error)}`,
      );
    });
  }
}

class BufferedMetricsRecorder {
  readonly runId: string;
  private readonly pnlPositions = new Map<string, PnlPosition>();
  private readonly openOrders = new Map<string, SubmittedOrderState>();
  private readonly orderAliases = new Map<string, string>();
  private cumulativeNetPnlUsd = 0;
  private peakNetPnlUsd = Number.NEGATIVE_INFINITY;
  private maxDrawdownUsd = 0;
  private readonly flushLoop: MetricsFlushLoop;
  private drained = false;

  constructor(
    private readonly repository: IMetricsRepository,
    private readonly options: MetricsRecorderOptions,
    private readonly buffer = new MetricsBuffer(),
  ) {
    this.runId = options.runId ?? randomUUID();
    this.flushLoop = new MetricsFlushLoop(this.buffer, {
      onDropSummary: async (summary) => this.recordDropSummary(summary),
    });
  }

  async start(startedAt = Date.now()): Promise<void> {
    await this.repository.startRun({
      id: this.runId,
      mode: this.options.mode,
      venue: this.options.venue,
      capitalMode: this.options.capitalMode,
      market: this.options.market,
      strategyName: this.options.strategyName,
      configJson: this.options.configJson,
      gitSha: this.options.gitSha,
      gitDirty: this.options.gitDirty,
      startedAt,
      status: "running",
    });
    this.flushLoop.start();
    this.drained = false;
  }

  async finish(
    endedAt = Date.now(),
    status: TradingRunFact["status"] = "completed",
    stopReason?: string,
  ): Promise<void> {
    if (!this.drained) {
      await this.drainAndStop();
    }
    await this.repository.finishRun(this.runId, endedAt, status, stopReason);
  }

  async drainAndStop(timeoutMs?: number): Promise<void> {
    if (this.drained) {
      return;
    }
    await this.flushLoop.drainAndStop(timeoutMs);
    this.drained = true;
  }

  async recordMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
    const observedAt = secondBucket(snapshot.timestamp);
    const orderbookSnapshot = {
      id: `${this.runId}:${snapshot.market}:${observedAt}`,
      runId: this.runId,
      venue: this.options.venue,
      market: snapshot.market,
      observedAt,
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      midPrice: midPrice(snapshot),
      microPrice: snapshot.microPrice,
      vampPrice: snapshot.vampPrice,
      markPrice: snapshot.markPrice,
      spreadBps: spreadBps(snapshot),
      stalenessMs: Math.max(0, Date.now() - (snapshot.bookUpdatedAt ?? snapshot.timestamp)),
      rawJson: snapshotPayload(snapshot),
    };
    this.enqueue("orderbook_snapshot", "normal", async () => {
      await this.repository.recordOrderbookSnapshot(orderbookSnapshot);
    });
    if (snapshot.marginRatio !== null) {
      const accountObservation = {
        id: `${this.runId}:${snapshot.market}:${observedAt}:account`,
        runId: this.runId,
        venue: this.options.venue,
        market: snapshot.market,
        observedAt,
        marginRatio: snapshot.marginRatio,
        positionQty: snapshot.positionQty ?? undefined,
        unrealizedPnl: snapshot.unrealizedPnl ?? undefined,
        rawJson: { source: "market_snapshot" },
      };
      this.enqueue("account_state", "normal", async () => {
        await this.repository.recordAccountStateObservation(accountObservation);
      });
    }
  }

  async recordQuote(
    snapshot: MarketSnapshot,
    positionQty: number,
    quote: Quote,
    quoteCycleId = `${snapshot.market}:${snapshot.timestamp}`,
  ): Promise<void> {
    const accountObservation = {
      id: `${this.runId}:${snapshot.market}:${snapshot.timestamp}:quote`,
      runId: this.runId,
      venue: this.options.venue,
      market: snapshot.market,
      observedAt: snapshot.timestamp,
      positionQty,
      marginRatio: snapshot.marginRatio,
      unrealizedPnl: snapshot.unrealizedPnl ?? undefined,
      rawJson: {
        source: "quote",
        fairPrice: quote.fairPrice,
        sigma: quote.sigma,
        bid: quote.bid,
        ask: quote.ask,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        levels: quote.levels,
        policy: quote.policy,
        alphaDriftBps: quote.alphaDriftBps,
        fundingRateBps: quote.fundingRateBps,
        expectedFundingBps: quote.expectedFundingBps,
        basisBps: quote.basisBps,
        targetInventoryQty: quote.targetInventoryQty,
        inventoryErrorQty: quote.inventoryErrorQty,
        quotedSpreadBps: distanceBps(quote.ask, quote.bid),
        bidDistanceBps: distanceBps(quote.fairPrice, quote.bid),
        askDistanceBps: distanceBps(quote.ask, quote.fairPrice),
        marketSpreadBps: spreadBps(snapshot),
      },
    };
    this.enqueue("account_state", "normal", async () => {
      await this.repository.recordAccountStateObservation(accountObservation);
    });
    for (const decision of quoteDecisionFacts({
      runId: this.runId,
      venue: this.options.venue,
      snapshot,
      positionQty,
      quote,
      quoteCycleId,
    })) {
      this.enqueue("quote_decision", "normal", async () => {
        await this.repository.recordQuoteDecision(decision);
      });
    }
  }

  async recordOrder(payload: OrderGatewayEvent, market = this.options.market): Promise<void> {
    const orderKey = this.orderKeyFor(payload);
    const previous = orderKey === undefined ? undefined : this.openOrders.get(orderKey);
    const now = Date.now();
    const lifecycleEvent = orderLifecycleEvent(
      this.runId,
      this.options.venue,
      market,
      payload,
      orderKey,
      previous,
      now,
    );
    this.enqueue("order_lifecycle", "critical", async () => {
      await this.repository.recordOrderLifecycleEvent(lifecycleEvent);
    });
    if (payload.action === "cancel" && orderKey === undefined) {
      this.recordCancelAll(payload, market, now);
      return;
    }
    if (
      orderKey === undefined ||
      (payload.side === undefined && previous?.side === undefined) ||
      (payload.qty === undefined && previous?.quantity === undefined) ||
      (payload.timeInForce === undefined && previous?.timeInForce === undefined)
    ) {
      return;
    }
    const order = this.orderFactFrom(payload, orderKey, now, market, previous);
    this.enqueue("submitted_order", "critical", async () => {
      await this.repository.recordSubmittedOrder(order);
    });
    this.updateOrderState(order);
  }

  private recordCancelAll(
    payload: OrderGatewayEvent,
    market = this.options.market,
    now = Date.now(),
  ): void {
    const openOrders = [...this.openOrders.entries()].filter(
      ([, order]) => order.market === market,
    );
    for (const [orderKey, order] of openOrders) {
      const canceledOrder: SubmittedOrderFact = {
        ...order,
        canceledAt: now,
        finalStatus: "canceled",
        latencyMs: payload.latencyMs,
        rawJson: rawSummary(payload, "cancelAll"),
      };
      this.enqueue("submitted_order", "critical", async () => {
        await this.repository.recordSubmittedOrder(canceledOrder);
      });
      const lifecycleEvent: OrderLifecycleEventFact = {
        id: `${this.runId}:${order.clientOrderId}:cancelAll:${now}`,
        runId: this.runId,
        venue: this.options.venue,
        market: order.market,
        action: "cancel",
        clientOrderId: order.clientOrderId,
        venueOrderId: order.venueOrderId,
        side: order.side,
        intent: order.intent,
        orderType: order.orderType,
        price: order.limitPrice,
        quantity: order.quantity,
        timeInForce: order.timeInForce,
        status: "canceled",
        latencyMs: payload.latencyMs,
        observedAt: now,
        rawJson: rawSummary(payload, "cancelAll"),
      };
      this.enqueue("order_lifecycle", "critical", async () => {
        await this.repository.recordOrderLifecycleEvent(lifecycleEvent);
      });
      this.openOrders.delete(orderKey);
    }
  }

  private orderKeyFor(payload: OrderGatewayEvent): string | undefined {
    const rawKey = payload.clientOrderId ?? payload.orderId;
    if (rawKey === undefined) {
      return undefined;
    }
    return this.orderAliases.get(rawKey) ?? rawKey;
  }

  private orderFactFrom(
    payload: OrderGatewayEvent,
    orderKey: string,
    now: number,
    market: string,
    previous: SubmittedOrderState | undefined,
  ): SubmittedOrderFact {
    const submittedAt =
      previous?.submittedAt ?? (payload.action === "submit" ? now : now - (payload.latencyMs ?? 0));
    const status = finalStatus(payload);
    const acceptedAt =
      payload.action === "ack" && status === "accepted" ? now : previous?.acceptedAt;
    return {
      id: submittedOrderId(this.runId, orderKey),
      runId: this.runId,
      venue: this.options.venue,
      market: previous?.market ?? market,
      clientOrderId: previous?.clientOrderId ?? payload.clientOrderId ?? orderKey,
      venueOrderId: payload.orderId ?? previous?.venueOrderId,
      intent:
        payload.intent ?? previous?.intent ?? (payload.reduceOnly === true ? "reduce" : "quote"),
      side: payload.side ?? previous?.side ?? "buy",
      orderType:
        payload.orderType ??
        previous?.orderType ??
        (payload.price === undefined ? "market" : "limit"),
      limitPrice: payload.price ?? previous?.limitPrice,
      quantity: payload.qty ?? previous?.quantity ?? 0,
      timeInForce: payload.timeInForce ?? previous?.timeInForce ?? "GTC",
      submittedAt,
      acceptedAt,
      rejectedAt: status === "rejected" ? now : previous?.rejectedAt,
      canceledAt: status === "canceled" ? now : previous?.canceledAt,
      finalStatus: status,
      rejectReason: payload.reason,
      latencyMs: payload.latencyMs,
      rawJson: rawSummary(payload),
    };
  }

  private updateOrderState(order: SubmittedOrderFact): void {
    const orderKey = order.clientOrderId;
    if (order.venueOrderId !== undefined) {
      this.orderAliases.set(order.venueOrderId, orderKey);
    }
    if (
      order.finalStatus === "canceled" ||
      order.finalStatus === "rejected" ||
      order.finalStatus === "filled"
    ) {
      this.openOrders.delete(orderKey);
      return;
    }
    this.openOrders.set(orderKey, order);
  }

  getRuntimeRisk(): { netPnlUsd: number; peakNetPnlUsd: number; maxDrawdownUsd: number } {
    const peakNetPnlUsd = this.peakNetPnlUsd === Number.NEGATIVE_INFINITY ? 0 : this.peakNetPnlUsd;
    return {
      netPnlUsd: this.cumulativeNetPnlUsd,
      peakNetPnlUsd,
      maxDrawdownUsd: this.maxDrawdownUsd,
    };
  }

  async recordFill(fill: Fill): Promise<void> {
    const tradePnl = this.computeTradePnl(fill);
    const netDelta = tradePnl - fill.fee;
    this.cumulativeNetPnlUsd += netDelta;
    this.peakNetPnlUsd = Math.max(this.peakNetPnlUsd, this.cumulativeNetPnlUsd);
    this.maxDrawdownUsd = Math.max(
      this.maxDrawdownUsd,
      this.peakNetPnlUsd - this.cumulativeNetPnlUsd,
    );
    const orderKey = fill.quoteId === undefined ? undefined : this.orderAliases.get(fill.quoteId);
    const tradeFill = {
      id: fill.id,
      runId: this.runId,
      submittedOrderId:
        fill.quoteId === undefined
          ? undefined
          : submittedOrderId(this.runId, orderKey ?? fill.quoteId),
      venue: fill.venue,
      market: fill.market,
      venueFillId: fill.id,
      venueOrderId: fill.quoteId,
      side: fill.side,
      price: fill.price,
      quantity: fill.qty,
      fee: fill.fee,
      tradePnl,
      makerTaker: fill.makerTaker ?? "unknown",
      filledAt: fill.filledAt,
      rawJson: { ...fill, computedTradePnl: tradePnl },
    };
    this.enqueue("trade_fill", "critical", async () => {
      await this.repository.recordTradeFill(tradeFill);
    });
  }

  async recordRuntimeHealth(
    level: "info" | "warn" | "error",
    code: string,
    message: string,
    rawSummary?: unknown,
  ): Promise<void> {
    const observedAt = Date.now();
    const event = {
      id: `${this.runId}:${code}:${observedAt}`,
      runId: this.runId,
      venue: this.options.venue,
      market: this.options.market,
      observedAt,
      level,
      code,
      message,
      rawJson: rawSummary,
    };
    this.enqueue("runtime_health", "normal", async () => {
      await this.repository.recordRuntimeHealthEvent(event);
    });
  }

  private computeTradePnl(fill: Fill): number {
    const position = this.pnlPositions.get(fill.market) ?? { qty: 0, avgEntry: 0 };
    const signedQty = fill.side === "buy" ? fill.qty : -fill.qty;
    const previousQty = position.qty;
    const nextQty = previousQty + signedQty;
    let tradePnl = 0;

    if (previousQty === 0 || Math.sign(previousQty) === Math.sign(signedQty)) {
      const previousNotional = position.avgEntry * Math.abs(previousQty);
      const nextNotional = fill.price * Math.abs(signedQty);
      const totalQty = Math.abs(previousQty) + Math.abs(signedQty);
      position.avgEntry = totalQty === 0 ? 0 : (previousNotional + nextNotional) / totalQty;
    } else {
      const closingQty = Math.min(Math.abs(previousQty), Math.abs(signedQty));
      tradePnl =
        previousQty > 0
          ? (fill.price - position.avgEntry) * closingQty
          : (position.avgEntry - fill.price) * closingQty;

      if (nextQty === 0) {
        position.avgEntry = 0;
      } else if (Math.sign(nextQty) !== Math.sign(previousQty)) {
        position.avgEntry = fill.price;
      }
    }

    position.qty = nextQty;
    this.pnlPositions.set(fill.market, position);
    return Number(tradePnl.toFixed(12));
  }

  enqueue(
    type: MetricsOperationType,
    priority: MetricsOperationPriority,
    run: () => Promise<void>,
  ): void {
    this.buffer.enqueue({ type, priority, run });
  }

  private async recordDropSummary(summary: MetricsDropSummary): Promise<void> {
    const observedAt = Date.now();
    const droppedTotal = Object.values(summary.dropped).reduce((sum, count) => sum + count, 0);
    if (droppedTotal > 0) {
      await this.repository.recordRuntimeHealthEvent({
        id: `${this.runId}:metrics_buffer_dropped:${observedAt}`,
        runId: this.runId,
        venue: this.options.venue,
        market: this.options.market,
        observedAt,
        level: "warn",
        code: "metrics_buffer_dropped",
        message: "Metrics buffer dropped low-priority facts",
        rawJson: { dropped: summary.dropped },
      });
    }
    if (summary.criticalBacklogExceeded > 0) {
      await this.repository.recordRuntimeHealthEvent({
        id: `${this.runId}:metrics_critical_backlog_exceeded:${observedAt}`,
        runId: this.runId,
        venue: this.options.venue,
        market: this.options.market,
        observedAt,
        level: "error",
        code: "metrics_critical_backlog_exceeded",
        message: "Critical metrics backlog exceeded configured capacity",
        rawJson: { count: summary.criticalBacklogExceeded },
      });
    }
  }
}

export { BufferedMetricsRecorder as MetricsRecorder };

function midPrice(snapshot: MarketSnapshot): number {
  return (snapshot.bestBid + snapshot.bestAsk) / 2;
}

function spreadBps(snapshot: MarketSnapshot): number {
  return distanceBps(snapshot.bestAsk, snapshot.bestBid);
}

function distanceBps(upper: number, lower: number): number {
  if (lower <= 0) {
    return 0;
  }
  return ((upper - lower) / lower) * 10_000;
}

function secondBucket(timestamp: number): number {
  return Math.floor(timestamp / 1000) * 1000;
}

function submittedOrderId(runId: string, orderKey: string): string {
  return `${runId}:${orderKey}`;
}

function orderLifecycleEvent(
  runId: string,
  venue: string,
  market: string,
  payload: OrderGatewayEvent,
  orderKey: string | undefined,
  previous: SubmittedOrderFact | undefined,
  observedAt: number,
): OrderLifecycleEventFact {
  const eventKey = orderKey ?? payload.clientOrderId ?? payload.orderId ?? "unknown";
  return {
    id: `${runId}:${eventKey}:${payload.action}:${observedAt}`,
    runId,
    venue,
    market: previous?.market ?? market,
    action: payload.action,
    clientOrderId: previous?.clientOrderId ?? payload.clientOrderId,
    venueOrderId: payload.orderId ?? previous?.venueOrderId,
    side: payload.side ?? previous?.side,
    intent: payload.intent ?? previous?.intent,
    orderType: payload.orderType ?? previous?.orderType,
    price: payload.price ?? previous?.limitPrice,
    quantity: payload.qty ?? previous?.quantity,
    timeInForce: payload.timeInForce ?? previous?.timeInForce,
    status:
      payload.status ?? (previous?.finalStatus === undefined ? undefined : previous.finalStatus),
    latencyMs: payload.latencyMs,
    observedAt,
    rawJson: rawSummary(payload),
  };
}

function quoteDecisionFacts(input: {
  runId: string;
  venue: string;
  snapshot: MarketSnapshot;
  positionQty: number;
  quote: Quote;
  quoteCycleId: string;
}) {
  const levels = input.quote.levels ?? [
    {
      level: 0,
      bid: input.quote.bid,
      ask: input.quote.ask,
      bidSize: input.quote.bidSize,
      askSize: input.quote.askSize,
      bidIntent: input.quote.bidIntent,
      askIntent: input.quote.askIntent,
      bidControlReasons: input.quote.bidControlReasons,
      askControlReasons: input.quote.askControlReasons,
    },
  ];
  const createdAt = input.snapshot.timestamp;
  const base = {
    runId: input.runId,
    venue: input.venue,
    market: input.snapshot.market,
    quoteCycleId: input.quoteCycleId,
    fairPrice: input.quote.fairPrice,
    sigma: input.quote.sigma,
    policy: input.quote.policy,
    positionQty: input.positionQty,
    midPrice: midPrice(input.snapshot),
    microPrice: input.snapshot.microPrice,
    markPrice: input.snapshot.markPrice,
    spreadBps: spreadBps(input.snapshot),
    stalenessMs: Math.max(
      0,
      Date.now() - (input.snapshot.bookUpdatedAt ?? input.snapshot.timestamp),
    ),
    createdAt,
  };
  return levels.flatMap((level) => [
    {
      ...base,
      id: `${input.runId}:${input.quoteCycleId}:buy:${level.level}`,
      side: "buy" as OrderSide,
      level: level.level,
      intent: quoteDecisionIntent(level.bidIntent),
      price: level.bid,
      quantity: level.bidSize,
      controlReasons: level.bidControlReasons ?? [],
      rawJson: quoteSignalDiagnostics(input.quote, halfSpreadBpsOrUndefined(level)),
    },
    {
      ...base,
      id: `${input.runId}:${input.quoteCycleId}:sell:${level.level}`,
      side: "sell" as OrderSide,
      level: level.level,
      intent: quoteDecisionIntent(level.askIntent),
      price: level.ask,
      quantity: level.askSize,
      controlReasons: level.askControlReasons ?? [],
      rawJson: quoteSignalDiagnostics(input.quote, halfSpreadBpsOrUndefined(level)),
    },
  ]);
}

function quoteSignalDiagnostics(
  quote: Quote,
  halfSpreadBps: number | undefined,
): Record<string, number | undefined> {
  return {
    halfSpreadBps,
    alphaDriftBps: quote.alphaDriftBps,
    fundingRateBps: quote.fundingRateBps,
    expectedFundingBps: quote.expectedFundingBps,
    basisBps: quote.basisBps,
    targetInventoryQty: quote.targetInventoryQty,
    inventoryErrorQty: quote.inventoryErrorQty,
  };
}

function halfSpreadBpsOrUndefined(level: unknown): number | undefined {
  if (level !== null && typeof level === "object" && "halfSpreadBps" in level) {
    return level.halfSpreadBps as number | undefined;
  }
  return undefined;
}

function quoteDecisionIntent(intent: ExposureIntent | undefined): "quote" | "reduce" | "disabled" {
  return match(intent)
    .with("reduce_exposure", () => "reduce" as const)
    .with("disabled", () => "disabled" as const)
    .otherwise(() => "quote" as const);
}

function finalStatus(
  payload: OrderGatewayEvent,
): "submitted" | "accepted" | "rejected" | "canceled" | "filled" {
  const venueStatus = normalizeVenueStatus(payload.status);
  return match({ venueStatus, action: payload.action })
    .with({ venueStatus: "filled" }, () => "filled" as const)
    .with({ venueStatus: "canceled" }, () => "canceled" as const)
    .with({ venueStatus: "rejected" }, () => "rejected" as const)
    .with({ action: "submit" }, () => "submitted" as const)
    .with({ action: "reject" }, () => "rejected" as const)
    .with({ action: "cancel" }, () => "canceled" as const)
    .with({ action: "fill" }, () => "filled" as const)
    .otherwise(() => "accepted" as const);
}

function normalizeVenueStatus(
  status: string | undefined,
): "filled" | "canceled" | "rejected" | null {
  const normalized = status?.toLowerCase();
  return match(normalized)
    .with(undefined, () => null)
    .with("filled", () => "filled" as const)
    .with("rejected", () => "rejected" as const)
    .with(
      P.when(
        (value): value is string =>
          typeof value === "string" &&
          (value === "cancelled" ||
            value === "canceled" ||
            value.startsWith("cancelled") ||
            value.startsWith("canceled")),
      ),
      () => "canceled" as const,
    )
    .otherwise(() => null);
}

function rawSummary(payload: OrderGatewayEvent, cancelSource?: "cancelAll"): unknown {
  if (cancelSource === undefined) {
    return payload.rawSummary;
  }
  if (payload.rawSummary !== null && typeof payload.rawSummary === "object") {
    return { ...payload.rawSummary, cancelSource };
  }
  return { rawSummary: payload.rawSummary, cancelSource };
}

function snapshotPayload(snapshot: MarketSnapshot): Record<string, unknown> {
  return {
    timestamp: snapshot.timestamp,
    bookUpdatedAt: snapshot.bookUpdatedAt,
    tickerUpdatedAt: snapshot.tickerUpdatedAt,
    bookReceivedAt: snapshot.bookReceivedAt,
    tickerReceivedAt: snapshot.tickerReceivedAt,
    bookExchangeTimestamp: snapshot.bookExchangeTimestamp,
    tickerExchangeTimestamp: snapshot.tickerExchangeTimestamp,
    candleUpdatedAt: snapshot.candleUpdatedAt,
    accountUpdatedAt: snapshot.accountUpdatedAt,
    positionUpdatedAt: snapshot.positionUpdatedAt,
    positionQty: snapshot.positionQty,
    marginRatio: snapshot.marginRatio,
    indexPrice: snapshot.indexPrice,
    oraclePrice: snapshot.oraclePrice,
    fundingRateBps: snapshot.fundingRateBps,
    vampPrice: snapshot.vampPrice,
    orderBookLevels: snapshot.orderBookLevels,
    ohlcvPresent:
      snapshot.open !== undefined ||
      snapshot.high !== undefined ||
      snapshot.low !== undefined ||
      snapshot.close !== undefined ||
      snapshot.volume !== undefined,
  };
}
