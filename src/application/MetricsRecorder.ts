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

interface PnlPosition {
  qty: number;
  avgEntry: number;
}

export class MetricsRecorder {
  readonly runId: string;
  private readonly pnlPositions = new Map<string, PnlPosition>();

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
    await this.repository.recordAccountStateObservation({
      id: `${this.runId}:${snapshot.market}:${snapshot.timestamp}:quote`,
      runId: this.runId,
      venue: this.options.venue,
      market: snapshot.market,
      observedAt: snapshot.timestamp,
      positionQty,
      marginRatio: snapshot.marginRatio,
      rawJson: {
        source: "quote",
        fairPrice: quote.fairPrice,
        sigma: quote.sigma,
        bid: quote.bid,
        ask: quote.ask,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        policy: quote.policy,
        quotedSpreadBps: distanceBps(quote.ask, quote.bid),
        bidDistanceBps: distanceBps(quote.fairPrice, quote.bid),
        askDistanceBps: distanceBps(quote.ask, quote.fairPrice),
        marketSpreadBps: spreadBps(snapshot),
      },
    });
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
    const tradePnl = this.computeTradePnl(fill);
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
      tradePnl,
      makerTaker: "unknown",
      filledAt: fill.filledAt,
      rawJson: { ...fill, computedTradePnl: tradePnl },
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
