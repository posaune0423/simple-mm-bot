import { describe, expect, spyOn, test } from "bun:test";

import { MetricsRecorder } from "../../src/application/MetricsRecorder.ts";
import type { Fill } from "../../src/domain/entities/Fill.ts";
import type {
  AccountStateObservationFact,
  OrderLifecycleEventFact,
  OrderbookSnapshotFact,
  QuoteDecisionFact,
  RuntimeHealthEventFact,
  SubmittedOrderFact,
  TradeFillFact,
  TradingRunFact,
} from "../../src/domain/ports/IMetricsRepository.ts";
import type { IMetricsRepository } from "../../src/domain/ports/IMetricsRepository.ts";

class MemoryMetricsRepository implements IMetricsRepository {
  runs = new Map<string, TradingRunFact>();
  snapshots: OrderbookSnapshotFact[] = [];
  orders: SubmittedOrderFact[] = [];
  fills: TradeFillFact[] = [];
  accounts: AccountStateObservationFact[] = [];
  runtimeHealth: RuntimeHealthEventFact[] = [];
  quoteDecisions: QuoteDecisionFact[] = [];
  lifecycleEvents: OrderLifecycleEventFact[] = [];

  async startRun(run: TradingRunFact): Promise<void> {
    this.runs.set(run.id, run);
  }

  async finishRun(
    runId: string,
    endedAt: number,
    status: TradingRunFact["status"],
    stopReason?: string,
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) {
      this.runs.set(runId, { ...run, endedAt, status, stopReason });
    }
  }

  async recordOrderbookSnapshot(snapshot: OrderbookSnapshotFact): Promise<void> {
    this.snapshots.push(snapshot);
  }

  async recordSubmittedOrder(order: SubmittedOrderFact): Promise<void> {
    this.orders.push(order);
  }

  async recordTradeFill(fill: TradeFillFact): Promise<void> {
    this.fills.push(fill);
  }

  async recordAccountStateObservation(observation: AccountStateObservationFact): Promise<void> {
    this.accounts.push(observation);
  }

  async recordRuntimeHealthEvent(event: RuntimeHealthEventFact): Promise<void> {
    this.runtimeHealth.push(event);
  }

  async recordQuoteDecision(decision: QuoteDecisionFact): Promise<void> {
    this.quoteDecisions.push(decision);
  }

  async recordOrderLifecycleEvent(event: OrderLifecycleEventFact): Promise<void> {
    this.lifecycleEvents.push(event);
  }

  async findRun(runId: string): Promise<TradingRunFact | null> {
    return this.runs.get(runId) ?? null;
  }
}

describe("MetricsRecorder", () => {
  test("records run, orderbook, account, and fill facts", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-1",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.start(1000);
    await recorder.recordMarketSnapshot({
      market: "BTC-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100.25,
      markPrice: 100,
      timestamp: 1000,
      marginRatio: 0.9,
    });
    const fill: Fill = {
      id: "fill-1",
      venue: "bulk",
      market: "BTC-USD",
      side: "buy",
      price: 100,
      qty: 1,
      fee: 0.01,
      tradePnl: 0,
      filledAt: 1000,
      quoteId: "order-1",
      markPriceAtFill: 100,
    };
    await recorder.recordFill(fill);
    await recorder.finish(7000, "completed");

    expect(repository.runs.get("run-1")).toMatchObject({ endedAt: 7000, status: "completed" });
    expect(repository.snapshots).toHaveLength(1);
    expect(repository.snapshots[0]).toMatchObject({
      runId: "run-1",
      market: "BTC-USD",
      observedAt: 1000,
      bestBid: 99,
      bestAsk: 101,
      midPrice: 100,
    });
    expect(repository.snapshots[0]?.spreadBps).toBeCloseTo(202.0202, 4);
    expect(repository.accounts).toEqual([
      expect.objectContaining({
        runId: "run-1",
        market: "BTC-USD",
        observedAt: 1000,
        marginRatio: 0.9,
      }),
    ]);
    expect(repository.fills).toEqual([
      expect.objectContaining({
        id: "fill-1",
        runId: "run-1",
        venueFillId: "fill-1",
        venueOrderId: "order-1",
        price: 100,
        quantity: 1,
        makerTaker: "unknown",
      }),
    ]);
  });

  test("preserves maker/taker classification from venue fills", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-maker",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "bulk-beta-leaderboard",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordFill({
      id: "fill-maker",
      venue: "bulk",
      market: "BTC-USD",
      side: "sell",
      price: 100,
      qty: 1,
      fee: -0.01,
      tradePnl: 0,
      filledAt: 1000,
      makerTaker: "maker",
    });

    expect(repository.fills[0]).toMatchObject({
      id: "fill-maker",
      makerTaker: "maker",
    });
  });

  test("records submitted order lifecycle facts", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-order",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.start(1000);
    await recorder.recordOrder({
      action: "submit",
      clientOrderId: "client-1",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      price: 99,
      qty: 1,
      timeInForce: "GTC",
    });
    await recorder.recordOrder({
      action: "ack",
      clientOrderId: "client-1",
      orderId: "venue-1",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      price: 99,
      qty: 1,
      timeInForce: "GTC",
      latencyMs: 25,
      status: "open",
      rawSummary: { status: "resting" },
    });

    expect(repository.orders).toEqual([
      expect.objectContaining({
        id: "run-order:client-1",
        clientOrderId: "client-1",
        finalStatus: "submitted",
      }),
      expect.objectContaining({
        id: "run-order:client-1",
        clientOrderId: "client-1",
        venueOrderId: "venue-1",
        finalStatus: "accepted",
        latencyMs: 25,
      }),
    ]);
    expect(repository.lifecycleEvents).toEqual([
      expect.objectContaining({
        runId: "run-order",
        action: "submit",
        clientOrderId: "client-1",
        side: "buy",
        observedAt: expect.any(Number),
      }),
      expect.objectContaining({
        runId: "run-order",
        action: "ack",
        clientOrderId: "client-1",
        venueOrderId: "venue-1",
        status: "open",
        latencyMs: 25,
      }),
    ]);
  });

  test("records bare cancelAll events against tracked open orders", async () => {
    const now = spyOn(Date, "now");
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1050).mockReturnValueOnce(2000);
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-cancel-all",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordOrder({
      action: "submit",
      clientOrderId: "cycle-1:bid:0",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      price: 99,
      qty: 1,
      timeInForce: "GTC",
    });
    await recorder.recordOrder({
      action: "ack",
      clientOrderId: "cycle-1:bid:0",
      orderId: "venue-1",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      price: 99,
      qty: 1,
      timeInForce: "GTC",
      latencyMs: 50,
      status: "open",
    });
    await recorder.recordOrder({
      action: "cancel",
      latencyMs: 30,
      rawSummary: { request: "cancelAll" },
    });

    expect(repository.orders.at(-1)).toMatchObject({
      id: "run-cancel-all:cycle-1:bid:0",
      clientOrderId: "cycle-1:bid:0",
      venueOrderId: "venue-1",
      finalStatus: "canceled",
      submittedAt: 1000,
      acceptedAt: 1050,
      canceledAt: 2000,
      latencyMs: 30,
      rawJson: { request: "cancelAll", cancelSource: "cancelAll" },
    });
    now.mockRestore();
  });

  test("records terminal ack statuses as terminal order facts", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-terminal-ack",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "bulk-beta-leaderboard",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordOrder({
      action: "submit",
      clientOrderId: "client-cancelled",
      intent: "quote",
      side: "sell",
      orderType: "limit",
      price: 101,
      qty: 1,
      timeInForce: "GTC",
    });
    await recorder.recordOrder({
      action: "ack",
      clientOrderId: "client-cancelled",
      orderId: "venue-cancelled",
      intent: "quote",
      side: "sell",
      orderType: "limit",
      price: 101,
      qty: 1,
      timeInForce: "GTC",
      status: "cancelled",
      rawSummary: { status: "cancelled" },
    });

    expect(repository.orders.at(-1)).toMatchObject({
      id: "run-terminal-ack:client-cancelled",
      finalStatus: "canceled",
      venueOrderId: "venue-cancelled",
      rawJson: { status: "cancelled" },
    });
  });

  test("links late venue fills back to the submitted client order", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-late-fill",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordOrder({
      action: "submit",
      clientOrderId: "cycle-1:ask:0",
      intent: "quote",
      side: "sell",
      orderType: "limit",
      price: 101,
      qty: 1,
      timeInForce: "ALO",
    });
    await recorder.recordOrder({
      action: "ack",
      clientOrderId: "cycle-1:ask:0",
      orderId: "venue-fill-later",
      intent: "quote",
      side: "sell",
      orderType: "limit",
      price: 101,
      qty: 1,
      timeInForce: "ALO",
      status: "filled",
    });
    await recorder.recordFill({
      id: "fill-late",
      venue: "bulk",
      market: "BTC-USD",
      side: "sell",
      price: 101,
      qty: 1,
      fee: 0,
      tradePnl: 0,
      filledAt: 1000,
      quoteId: "venue-fill-later",
    });

    expect(repository.fills.at(-1)).toMatchObject({
      id: "fill-late",
      submittedOrderId: "run-late-fill:cycle-1:ask:0",
      venueOrderId: "venue-fill-later",
    });
  });

  test("records quote diagnostics as account state observations", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-quote",
      mode: "paper",
      venue: "bulk",
      capitalMode: "paper",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordQuote(
      {
        market: "BTC-USD",
        bestBid: 99,
        bestAsk: 101,
        microPrice: 100,
        markPrice: 100,
        timestamp: 1234,
        marginRatio: 0.8,
      },
      -0.25,
      {
        bid: 99.5,
        ask: 100.5,
        bidSize: 0.1,
        askSize: 0.2,
        policy: "GTC",
        fairPrice: 100,
        sigma: 0.01,
      },
      "cycle-quote",
    );

    expect(repository.accounts).toEqual([
      expect.objectContaining({
        id: "run-quote:BTC-USD:1234:quote",
        runId: "run-quote",
        market: "BTC-USD",
        observedAt: 1234,
        positionQty: -0.25,
        marginRatio: 0.8,
        rawJson: expect.objectContaining({
          source: "quote",
          quotedSpreadBps: 100.50251256281408,
          bidDistanceBps: 50.25125628140704,
          askDistanceBps: 50,
        }),
      }),
    ]);
    expect(repository.quoteDecisions).toEqual([
      expect.objectContaining({
        runId: "run-quote",
        market: "BTC-USD",
        quoteCycleId: "cycle-quote",
        side: "buy",
        level: 0,
        intent: "quote",
        price: 99.5,
        quantity: 0.1,
        fairPrice: 100,
        positionQty: -0.25,
      }),
      expect.objectContaining({
        runId: "run-quote",
        quoteCycleId: "cycle-quote",
        side: "sell",
        level: 0,
        intent: "quote",
        price: 100.5,
        quantity: 0.2,
      }),
    ]);
  });

  test("records runtime health events", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-health",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordRuntimeHealth("warn", "quote_side_skipped", "Skipped quote side", {
      reason: "stale_touch",
    });

    expect(repository.runtimeHealth).toEqual([
      expect.objectContaining({
        runId: "run-health",
        venue: "bulk",
        market: "BTC-USD",
        level: "warn",
        code: "quote_side_skipped",
        message: "Skipped quote side",
        rawJson: { reason: "stale_touch" },
      }),
    ]);
  });

  test("computes realized trade pnl from fill sequence for metrics facts", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-pnl",
      mode: "paper",
      venue: "bulk",
      capitalMode: "paper",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordFill({
      id: "buy-open",
      venue: "paper",
      market: "BTC-USD",
      side: "buy",
      price: 100,
      qty: 1,
      fee: 0.01,
      tradePnl: 0,
      filledAt: 1000,
    });
    await recorder.recordFill({
      id: "sell-reduce",
      venue: "paper",
      market: "BTC-USD",
      side: "sell",
      price: 102,
      qty: 0.4,
      fee: 0.01,
      tradePnl: 0,
      filledAt: 2000,
    });
    await recorder.recordFill({
      id: "sell-flip",
      venue: "paper",
      market: "BTC-USD",
      side: "sell",
      price: 99,
      qty: 1,
      fee: 0.01,
      tradePnl: 0,
      filledAt: 3000,
    });

    expect(repository.fills).toEqual([
      expect.objectContaining({ id: "buy-open", tradePnl: 0 }),
      expect.objectContaining({ id: "sell-reduce", tradePnl: 0.8 }),
      expect.objectContaining({ id: "sell-flip", tradePnl: -0.6 }),
    ]);
  });
});
