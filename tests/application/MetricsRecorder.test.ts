import { describe, expect, test } from "bun:test";

import { MetricsRecorder } from "../../src/application/MetricsRecorder.ts";
import type { Fill } from "../../src/domain/entities/Fill.ts";
import type {
  AccountStateObservationFact,
  OrderbookSnapshotFact,
  SubmittedOrderFact,
  TradeFillFact,
  TradingRunFact,
} from "../../src/infrastructure/Metrics.ts";
import type { IMetricsRepository } from "../../src/infrastructure/MetricsRepository.ts";

class MemoryMetricsRepository implements IMetricsRepository {
  runs = new Map<string, TradingRunFact>();
  snapshots: OrderbookSnapshotFact[] = [];
  orders: SubmittedOrderFact[] = [];
  fills: TradeFillFact[] = [];
  accounts: AccountStateObservationFact[] = [];

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
      }),
    ]);
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
  });
});
