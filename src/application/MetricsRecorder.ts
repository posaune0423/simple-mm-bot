import { randomUUID } from "node:crypto";

import type { Fill } from "../domain/entities/Fill.ts";
import type { OrderSide, Quote, QuoteSideIntent } from "../domain/entities/Quote.ts";
import type { MarketSnapshot } from "../domain/ports/IMarketFeed.ts";
import type {
  CapitalMode,
  IMetricsRepository,
  OrderLifecycleEventFact,
  SubmittedOrderFact,
  TradingRunFact,
} from "../domain/ports/IMetricsRepository.ts";
import type { OrderGatewayEvent } from "../domain/ports/IOrderGateway.ts";
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

type SubmittedOrderState = SubmittedOrderFact;

export class MetricsRecorder {
  readonly runId: string;
  private readonly pnlPositions = new Map<string, PnlPosition>();
  private readonly openOrders = new Map<string, SubmittedOrderState>();
  private readonly orderAliases = new Map<string, string>();

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
      vampPrice: snapshot.vampPrice,
      markPrice: snapshot.markPrice,
      spreadBps: spreadBps(snapshot),
      stalenessMs: Math.max(0, Date.now() - (snapshot.bookUpdatedAt ?? snapshot.timestamp)),
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

  async recordQuote(
    snapshot: MarketSnapshot,
    positionQty: number,
    quote: Quote,
    quoteCycleId = `${snapshot.market}:${snapshot.timestamp}`,
  ): Promise<void> {
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
        levels: quote.levels,
        policy: quote.policy,
        quotedSpreadBps: distanceBps(quote.ask, quote.bid),
        bidDistanceBps: distanceBps(quote.fairPrice, quote.bid),
        askDistanceBps: distanceBps(quote.ask, quote.fairPrice),
        marketSpreadBps: spreadBps(snapshot),
      },
    });
    for (const decision of quoteDecisionFacts({
      runId: this.runId,
      venue: this.options.venue,
      snapshot,
      positionQty,
      quote,
      quoteCycleId,
    })) {
      await this.repository.recordQuoteDecision(decision);
    }
  }

  async recordOrder(payload: OrderGatewayEvent, market = this.options.market): Promise<void> {
    const orderKey = this.orderKeyFor(payload);
    const previous = orderKey === undefined ? undefined : this.openOrders.get(orderKey);
    const now = Date.now();
    await this.repository.recordOrderLifecycleEvent(
      orderLifecycleEvent(this.runId, this.options.venue, market, payload, orderKey, previous, now),
    );
    if (payload.action === "cancel" && orderKey === undefined) {
      await this.recordCancelAll(payload, market, now);
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
    await this.repository.recordSubmittedOrder(order);
    this.updateOrderState(order);
  }

  private async recordCancelAll(
    payload: OrderGatewayEvent,
    market = this.options.market,
    now = Date.now(),
  ) {
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
      await this.repository.recordSubmittedOrder(canceledOrder);
      await this.repository.recordOrderLifecycleEvent({
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

  async recordFill(fill: Fill): Promise<void> {
    const tradePnl = this.computeTradePnl(fill);
    const orderKey = fill.quoteId === undefined ? undefined : this.orderAliases.get(fill.quoteId);
    await this.repository.recordTradeFill({
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
    });
  }

  async recordRuntimeHealth(
    level: "info" | "warn" | "error",
    code: string,
    message: string,
    rawSummary?: unknown,
  ): Promise<void> {
    const observedAt = Date.now();
    await this.repository.recordRuntimeHealthEvent({
      id: `${this.runId}:${code}:${observedAt}`,
      runId: this.runId,
      venue: this.options.venue,
      market: this.options.market,
      observedAt,
      level,
      code,
      message,
      rawJson: rawSummary,
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
      rawJson: { halfSpreadBps: "halfSpreadBps" in level ? level.halfSpreadBps : undefined },
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
      rawJson: { halfSpreadBps: "halfSpreadBps" in level ? level.halfSpreadBps : undefined },
    },
  ]);
}

function quoteDecisionIntent(intent: QuoteSideIntent | undefined): "quote" | "reduce" | "disabled" {
  if (intent === "reduce_inventory") {
    return "reduce";
  }
  if (intent === "disabled") {
    return "disabled";
  }
  return "quote";
}

function finalStatus(
  payload: OrderGatewayEvent,
): "submitted" | "accepted" | "rejected" | "canceled" | "filled" {
  const venueStatus = normalizeVenueStatus(payload.status);
  if (venueStatus === "filled") {
    return "filled";
  }
  if (venueStatus === "canceled") {
    return "canceled";
  }
  if (venueStatus === "rejected") {
    return "rejected";
  }
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

function normalizeVenueStatus(
  status: string | undefined,
): "filled" | "canceled" | "rejected" | null {
  if (status === undefined) {
    return null;
  }
  const normalized = status.toLowerCase();
  if (normalized === "filled") {
    return "filled";
  }
  if (normalized === "rejected") {
    return "rejected";
  }
  if (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized.startsWith("cancelled") ||
    normalized.startsWith("canceled")
  ) {
    return "canceled";
  }
  return null;
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
    candleUpdatedAt: snapshot.candleUpdatedAt,
    accountUpdatedAt: snapshot.accountUpdatedAt,
    positionUpdatedAt: snapshot.positionUpdatedAt,
    positionQty: snapshot.positionQty,
    marginRatio: snapshot.marginRatio,
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
