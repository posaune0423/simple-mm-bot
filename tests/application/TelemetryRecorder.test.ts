import { describe, expect, test } from "bun:test";

import { TelemetryRecorder } from "../../src/application/TelemetryRecorder.ts";
import type { Fill } from "../../src/domain/entities/Fill.ts";
import type { TelemetryEvent, TelemetryRun } from "../../src/infrastructure/Telemetry.ts";
import type {
  ITelemetryRepository,
  TelemetryEventQuery,
} from "../../src/infrastructure/TelemetryRepository.ts";

class MemoryTelemetryRepository implements ITelemetryRepository {
  runs = new Map<string, TelemetryRun>();
  events: TelemetryEvent[] = [];

  async startRun(run: TelemetryRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async finishRun(runId: string, endedAt: number, status: TelemetryRun["status"]): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) {
      this.runs.set(runId, { ...run, endedAt, status });
    }
  }

  async recordEvent(event: TelemetryEvent): Promise<void> {
    this.events.push(event);
  }

  async findRun(runId: string): Promise<TelemetryRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async findEvents(query: TelemetryEventQuery): Promise<TelemetryEvent[]> {
    return this.events.filter((event) => query.runId === undefined || event.runId === query.runId);
  }
}

describe("TelemetryRecorder", () => {
  test("records snapshots, fills, and markouts after configured horizons", async () => {
    const repository = new MemoryTelemetryRepository();
    const recorder = new TelemetryRecorder(repository, {
      runId: "run-1",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      configJson: { venue: "bulk" },
      gitDirty: false,
      horizonsSec: [5],
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
    await recorder.recordMarketSnapshot({
      market: "BTC-USD",
      bestBid: 100,
      bestAsk: 102,
      microPrice: 101,
      markPrice: 101,
      timestamp: 6000,
      marginRatio: 0.9,
    });
    await recorder.finish(7000, "completed");

    expect(repository.runs.get("run-1")).toMatchObject({ endedAt: 7000, status: "completed" });
    expect(repository.events.map((event) => event.type)).toEqual([
      "market_snapshot",
      "fill",
      "market_snapshot",
      "markout",
    ]);
    const markout = repository.events.find((event) => event.type === "markout");
    expect(markout?.payload).toMatchObject({
      fillId: "fill-1",
      horizonSec: 5,
      markoutBps: 100,
      adverse: false,
    });
  });

  test("records positive spread capture for buy fills below the fill basis", async () => {
    const repository = new MemoryTelemetryRepository();
    const recorder = new TelemetryRecorder(repository, {
      runId: "run-spread",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      configJson: { venue: "bulk" },
      gitDirty: false,
      horizonsSec: [5],
    });
    const fill: Fill = {
      id: "buy-below-basis",
      venue: "bulk",
      market: "BTC-USD",
      side: "buy",
      price: 99,
      qty: 1,
      fee: 0.01,
      tradePnl: 0,
      filledAt: 1000,
      markPriceAtFill: 100,
    };

    await recorder.start(1000);
    await recorder.recordFill(fill);
    await recorder.recordMarketSnapshot({
      market: "BTC-USD",
      bestBid: 100,
      bestAsk: 102,
      microPrice: 101,
      markPrice: 101,
      timestamp: 6000,
      marginRatio: 0.9,
    });

    const markout = repository.events.find((event) => event.type === "markout");
    expect(markout?.payload.spreadCaptureBps).toBe(100);
  });
});
