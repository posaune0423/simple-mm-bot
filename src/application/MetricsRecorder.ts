import { randomUUID } from "node:crypto";

import type { Fill } from "../domain/entities/Fill.ts";
import type { Quote } from "../domain/entities/Quote.ts";
import type { MarketSnapshot } from "../domain/ports/IMarketFeed.ts";
import type { OrderGatewayEvent } from "../domain/ports/IOrderGateway.ts";
import type { CapitalMode, TradingRunFact } from "../infrastructure/Metrics.ts";
import type { IMetricsRepository } from "../infrastructure/MetricsRepository.ts";
import type { AppMode } from "../config.ts";

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

export class MetricsRecorder {
  readonly runId: string;

  constructor(
    private readonly repository: IMetricsRepository,
    private readonly options: MetricsRecorderOptions,
  ) {
    this.runId = options.runId ?? randomUUID();
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
  }

  async finish(
    endedAt = Date.now(),
    status: TradingRunFact["status"] = "completed",
    stopReason?: string,
  ): Promise<void> {
    await this.repository.finishRun(this.runId, endedAt, status, stopReason);
  }

  async recordMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
    const observedAt = secondBucket(snapshot.timestamp);
    await this.repository.recordOrderbookSnapshot({
      id: `${this.runId}:${snapshot.market}:${observedAt}`,
      runId: this.runId,
      venue: this.options.venue,
      market: snapshot.market,
      observedAt,
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      midPrice: midPrice(snapshot),
      microPrice: snapshot.microPrice,
      markPrice: snapshot.markPrice,
      spreadBps: spreadBps(snapshot),
      stalenessMs: Math.max(0, Date.now() - snapshot.timestamp),
      rawJson: snapshotPayload(snapshot),
    });
    if (snapshot.marginRatio !== null) {
      await this.repository.recordAccountStateObservation({
        id: `${this.runId}:${snapshot.market}:${observedAt}:account`,
        runId: this.runId,
        venue: this.options.venue,
        market: snapshot.market,
        observedAt,
        marginRatio: snapshot.marginRatio,
        rawJson: { source: "market_snapshot" },
      });
    }
  }

  async recordQuote(snapshot: MarketSnapshot, positionQty: number, quote: Quote): Promise<void> {
    void snapshot;
    void positionQty;
    void quote;
  }

  async recordOrder(payload: OrderGatewayEvent, market = this.options.market): Promise<void> {
    const orderKey = payload.clientOrderId ?? payload.orderId;
    if (
      orderKey === undefined ||
      payload.side === undefined ||
      payload.qty === undefined ||
      payload.timeInForce === undefined
    ) {
      return;
    }
    const now = Date.now();
    await this.repository.recordSubmittedOrder({
      id: submittedOrderId(this.runId, orderKey),
      runId: this.runId,
      venue: this.options.venue,
      market,
      clientOrderId: payload.clientOrderId ?? orderKey,
      venueOrderId: payload.orderId,
      intent: payload.intent ?? (payload.reduceOnly === true ? "reduce" : "quote"),
      side: payload.side,
      orderType: payload.orderType ?? (payload.price === undefined ? "market" : "limit"),
      limitPrice: payload.price,
      quantity: payload.qty,
      timeInForce: payload.timeInForce,
      submittedAt: payload.action === "submit" ? now : now - (payload.latencyMs ?? 0),
      acceptedAt: payload.action === "ack" ? now : undefined,
      rejectedAt: payload.action === "reject" ? now : undefined,
      canceledAt: payload.action === "cancel" ? now : undefined,
      finalStatus: finalStatus(payload),
      rejectReason: payload.reason,
      latencyMs: payload.latencyMs,
      rawJson: payload.rawSummary,
    });
  }

  async recordFill(fill: Fill): Promise<void> {
    await this.repository.recordTradeFill({
      id: fill.id,
      runId: this.runId,
      submittedOrderId:
        fill.quoteId === undefined ? undefined : submittedOrderId(this.runId, fill.quoteId),
      venue: fill.venue,
      market: fill.market,
      venueFillId: fill.id,
      venueOrderId: fill.quoteId,
      side: fill.side,
      price: fill.price,
      quantity: fill.qty,
      fee: fill.fee,
      tradePnl: fill.tradePnl,
      makerTaker: "unknown",
      filledAt: fill.filledAt,
      rawJson: fill,
    });
  }

  async recordRuntimeHealth(
    level: "info" | "warn" | "error",
    code: string,
    message: string,
    rawSummary?: unknown,
  ): Promise<void> {
    void level;
    void code;
    void message;
    void rawSummary;
  }
}

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

function finalStatus(
  payload: OrderGatewayEvent,
): "submitted" | "accepted" | "rejected" | "canceled" | "filled" {
  if (payload.action === "submit") {
    return "submitted";
  }
  if (payload.action === "reject") {
    return "rejected";
  }
  if (payload.action === "cancel") {
    return "canceled";
  }
  if (payload.action === "fill" || payload.status === "filled") {
    return "filled";
  }
  return "accepted";
}

function snapshotPayload(snapshot: MarketSnapshot): Record<string, unknown> {
  return {
    timestamp: snapshot.timestamp,
    marginRatio: snapshot.marginRatio,
    ohlcvPresent:
      snapshot.open !== undefined ||
      snapshot.high !== undefined ||
      snapshot.low !== undefined ||
      snapshot.close !== undefined ||
      snapshot.volume !== undefined,
  };
}
