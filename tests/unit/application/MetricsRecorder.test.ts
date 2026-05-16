import { describe, expect, spyOn, test } from "bun:test";

import {
  MetricsBuffer,
  MetricsFlushLoop,
  MetricsRecorder,
} from "../../../src/application/services/MetricsRecorder.ts";
import { logger } from "../../../src/utils/logger.ts";
import type { Fill } from "../../../src/domain/types/Fill.ts";
import type {
  AccountStateObservationFact,
  OrderLifecycleEventFact,
  OrderbookSnapshotFact,
  QuoteDecisionFact,
  SubmittedOrderFact,
  TradeFillFact,
  TradingRunFact,
} from "../../../src/domain/ports/IMetricsRepository.ts";
import type { IMetricsRepository } from "../../../src/domain/ports/IMetricsRepository.ts";

class MemoryMetricsRepository implements IMetricsRepository {
  runs = new Map<string, TradingRunFact>();
  snapshots: OrderbookSnapshotFact[] = [];
  orders: SubmittedOrderFact[] = [];
  fills: TradeFillFact[] = [];
  accounts: AccountStateObservationFact[] = [];
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

class BlockingMetricsRepository extends MemoryMetricsRepository {
  accountWritesStarted = 0;
  fillWritesStarted = 0;

  override async recordAccountStateObservation(
    observation: AccountStateObservationFact,
  ): Promise<void> {
    this.accountWritesStarted += 1;
    await new Promise(() => {});
    this.accounts.push(observation);
  }

  override async recordTradeFill(fill: TradeFillFact): Promise<void> {
    this.fillWritesStarted += 1;
    await new Promise(() => {});
    this.fills.push(fill);
  }
}

async function resolvesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return await Promise.race([promise.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
}

function fill(input: {
  id: string;
  side: Fill["side"];
  price: number;
  qty: number;
  fee: number;
}): Fill {
  return {
    id: input.id,
    venue: "bulk",
    market: "BTC-USD",
    side: input.side,
    price: input.price,
    qty: input.qty,
    fee: input.fee,
    tradePnl: 0,
    filledAt: 1000,
  };
}

describe("MetricsRecorder", () => {
  test("recordQuote returns without waiting for repository writes", async () => {
    const repository = new BlockingMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-nonblocking-quote",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    const settled = await resolvesWithin(
      recorder.recordQuote(
        {
          market: "BTC-USD",
          bestBid: 99,
          bestAsk: 101,
          microPrice: 100,
          markPrice: 100,
          timestamp: 1234,
          marginRatio: 0.8,
        },
        0,
        {
          bid: 99.5,
          ask: 100.5,
          bidSize: 0.1,
          askSize: 0.2,
          policy: "GTC",
          fairPrice: 100,
          sigma: 0.01,
        },
      ),
      20,
    );

    expect(settled).toBe(true);
    expect(repository.accountWritesStarted).toBe(0);
  });

  test("recordFill updates runtime risk before blocking repository writes finish", async () => {
    const repository = new BlockingMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-nonblocking-fill",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    expect(
      await resolvesWithin(
        recorder.recordFill(fill({ id: "fill-open", side: "buy", price: 100, qty: 1, fee: 0.1 })),
        20,
      ),
    ).toBe(true);

    expect(recorder.getRuntimeRisk()).toMatchObject({
      netPnlUsd: -0.1,
      peakNetPnlUsd: -0.1,
      maxDrawdownUsd: 0,
    });
    expect(repository.fillWritesStarted).toBe(0);
  });

  test("metrics buffer drops normal operations before critical operations", async () => {
    const buffer = new MetricsBuffer({ normalCapacity: 1, criticalCapacity: 2 });
    const calls: string[] = [];

    buffer.enqueue({
      type: "orderbook_snapshot",
      priority: "normal",
      run: async () => {
        calls.push("snapshot");
      },
    });
    buffer.enqueue({
      type: "quote_decision",
      priority: "normal",
      run: async () => {
        calls.push("quote");
      },
    });
    buffer.enqueue({
      type: "trade_fill",
      priority: "critical",
      run: async () => {
        calls.push("fill");
      },
    });

    const batch = buffer.drainBatch(10);
    for (const operation of batch) {
      await operation.run();
    }

    expect(calls).toEqual(["fill", "quote"]);
    expect(buffer.takeDropSummary().dropped).toEqual({ orderbook_snapshot: 1 });
  });

  test("metrics buffer preserves critical operations by dropping one normal operation", async () => {
    const buffer = new MetricsBuffer({ normalCapacity: 2, criticalCapacity: 2 });
    const calls: string[] = [];
    const enqueue = (type: Parameters<MetricsBuffer["enqueue"]>[0]["type"], label: string) => {
      buffer.enqueue({
        type,
        priority:
          type === "trade_fill" || type === "submitted_order" || type === "order_lifecycle"
            ? "critical"
            : "normal",
        run: async () => {
          calls.push(label);
        },
      });
    };

    enqueue("orderbook_snapshot", "normal-1");
    enqueue("quote_decision", "normal-2");
    enqueue("trade_fill", "critical-1");
    enqueue("submitted_order", "critical-2");
    enqueue("order_lifecycle", "critical-3");

    const batch = buffer.drainBatch(10);
    for (const operation of batch) {
      await operation.run();
    }

    expect(calls).toEqual(["critical-1", "critical-2", "critical-3", "normal-2"]);
    expect(buffer.takeDropSummary()).toEqual({
      dropped: { orderbook_snapshot: 1 },
      criticalBacklogExceeded: 1,
    });
  });

  test("metrics flush loop prevents reentry and limits a flush to the batch size", async () => {
    const buffer = new MetricsBuffer({ normalCapacity: 10, criticalCapacity: 10 });
    let releaseFirst: (() => void) | undefined;
    const firstStarted = Promise.withResolvers<void>();
    const calls: number[] = [];
    buffer.enqueue({
      type: "orderbook_snapshot",
      priority: "normal",
      run: async () => {
        calls.push(1);
        firstStarted.resolve();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      },
    });
    buffer.enqueue({
      type: "quote_decision",
      priority: "normal",
      run: async () => {
        calls.push(2);
      },
    });
    buffer.enqueue({
      type: "ohlcv",
      priority: "normal",
      run: async () => {
        calls.push(3);
      },
    });
    const loop = new MetricsFlushLoop(buffer, { batchSize: 2, intervalMs: 10 });

    const firstFlush = loop.flushOnce();
    await firstStarted.promise;
    await loop.flushOnce();
    releaseFirst?.();
    await firstFlush;

    expect(calls).toEqual([1, 2]);
    expect(buffer.pendingCount()).toBe(1);
  });

  test("metrics flush loop drain waits for an in-flight write before returning", async () => {
    const buffer = new MetricsBuffer({ normalCapacity: 10, criticalCapacity: 10 });
    const writeStarted = Promise.withResolvers<void>();
    let releaseWrite: (() => void) | undefined;
    buffer.enqueue({
      type: "orderbook_snapshot",
      priority: "normal",
      run: async () => {
        writeStarted.resolve();
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      },
    });
    const loop = new MetricsFlushLoop(buffer, { batchSize: 1, intervalMs: 10 });

    const drain = loop.drainAndStop(5);
    await writeStarted.promise;

    expect(await resolvesWithin(drain, 20)).toBe(false);
    releaseWrite?.();
    expect(await resolvesWithin(drain, 20)).toBe(true);
  });

  test("tracks live run net PnL and drawdown for runtime risk guards", async () => {
    const repository = new MemoryMetricsRepository();
    const recorder = new MetricsRecorder(repository, {
      runId: "run-risk",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { venue: "bulk" },
      gitDirty: false,
    });

    await recorder.recordFill(fill({ id: "fill-buy", side: "buy", price: 100, qty: 1, fee: 0.1 }));
    await recorder.recordFill(
      fill({ id: "fill-profit", side: "sell", price: 110, qty: 0.5, fee: 0.1 }),
    );
    await recorder.recordFill(
      fill({ id: "fill-loss", side: "sell", price: 90, qty: 0.5, fee: 0.1 }),
    );

    expect(recorder.getRuntimeRisk()).toEqual({
      netPnlUsd: expect.closeTo(-0.3),
      peakNetPnlUsd: expect.closeTo(4.8),
      maxDrawdownUsd: expect.closeTo(5.1),
    });
  });

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
      indexPrice: 100.5,
      oraclePrice: 99.5,
      fundingRateBps: 3.6,
      timestamp: 1000,
      marginRatio: 0.9,
      unrealizedPnl: 12.25,
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
    expect(repository.snapshots[0]?.rawJson).toMatchObject({
      indexPrice: 100.5,
      oraclePrice: 99.5,
      fundingRateBps: 3.6,
    });
    expect(repository.snapshots[0]?.spreadBps).toBeCloseTo(202.0202, 4);
    expect(repository.accounts).toEqual([
      expect.objectContaining({
        runId: "run-1",
        market: "BTC-USD",
        observedAt: 1000,
        marginRatio: 0.9,
        unrealizedPnl: 12.25,
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
    await recorder.drainAndStop();

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
    await recorder.drainAndStop();

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
    await recorder.drainAndStop();

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
    const cases = [
      { venueStatus: "cancelled", expectedFinalStatus: "canceled" },
      { venueStatus: "canceled by user", expectedFinalStatus: "canceled" },
      { venueStatus: "filled", expectedFinalStatus: "filled" },
      { venueStatus: "rejected", expectedFinalStatus: "rejected" },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const repository = new MemoryMetricsRepository();
      const recorder = new MetricsRecorder(repository, {
        runId: `run-terminal-ack-${index}`,
        mode: "live",
        venue: "bulk",
        capitalMode: "beta_mock",
        market: "BTC-USD",
        strategyName: "bulk-beta-leaderboard",
        configJson: { venue: "bulk" },
        gitDirty: false,
      });
      const clientOrderId = `client-${testCase.venueStatus.replaceAll(/\W+/g, "-")}`;

      await recorder.recordOrder({
        action: "submit",
        clientOrderId,
        intent: "quote",
        side: "sell",
        orderType: "limit",
        price: 101,
        qty: 1,
        timeInForce: "GTC",
      });
      await recorder.recordOrder({
        action: "ack",
        clientOrderId,
        orderId: `venue-${index}`,
        intent: "quote",
        side: "sell",
        orderType: "limit",
        price: 101,
        qty: 1,
        timeInForce: "GTC",
        status: testCase.venueStatus,
        rawSummary: { status: testCase.venueStatus },
      });
      await recorder.drainAndStop();

      expect(repository.orders.at(-1)).toMatchObject({
        id: `run-terminal-ack-${index}:${clientOrderId}`,
        finalStatus: testCase.expectedFinalStatus,
        venueOrderId: `venue-${index}`,
        rawJson: { status: testCase.venueStatus },
      });
    }
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
    await recorder.drainAndStop();

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
        unrealizedPnl: 6.5,
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
    await recorder.drainAndStop();

    expect(repository.accounts).toEqual([
      expect.objectContaining({
        id: "run-quote:BTC-USD:1234:quote",
        runId: "run-quote",
        market: "BTC-USD",
        observedAt: 1234,
        positionQty: -0.25,
        marginRatio: 0.8,
        unrealizedPnl: 6.5,
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

  test("logs runtime health without writing legacy health facts", async () => {
    const repository = new MemoryMetricsRepository();
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
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
    await recorder.drainAndStop();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[application] MetricsRecorder | HEALTH | runId=run-health"),
    );
    expect(repository.snapshots).toHaveLength(0);
    warnSpy.mockRestore();
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
    await recorder.drainAndStop();

    expect(repository.fills).toEqual([
      expect.objectContaining({ id: "buy-open", tradePnl: 0 }),
      expect.objectContaining({ id: "sell-reduce", tradePnl: 0.8 }),
      expect.objectContaining({ id: "sell-flip", tradePnl: -0.6 }),
    ]);
  });
});
