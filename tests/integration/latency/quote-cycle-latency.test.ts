import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { MetricsRecorder } from "../../../src/application/services/MetricsRecorder.ts";
import { OrderIntentBuilder } from "../../../src/application/services/OrderIntentBuilder.ts";
import { ManagedOrderReconciler } from "../../../src/application/services/ManagedOrderReconciler.ts";
import { QuotingCycleService } from "../../../src/application/services/QuotingCycleService.ts";
import { AvellanedaStoikovQuoteModel } from "../../../src/domain/quote-models/AvellanedaStoikovQuoteModel.ts";
import { FairPriceCalculator } from "../../../src/domain/services/FairPriceCalculator.ts";
import { QuoteEngine } from "../../../src/domain/services/QuoteEngine.ts";
import { VolatilityEstimator } from "../../../src/domain/services/VolatilityEstimator.ts";
import { SimplePmmStrategy } from "../../../src/domain/strategies/SimplePmmStrategy.ts";
import type { Fill } from "../../../src/domain/types/Fill.ts";
import type { Position } from "../../../src/domain/types/Position.ts";
import type { MarketSnapshot, SnapshotListener } from "../../../src/domain/ports/IMarketFeed.ts";
import type {
  FillListener,
  IOrderGateway,
  OrderRequest,
  PlacedOrder,
} from "../../../src/domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../../src/domain/ports/IPositionRepository.ts";
import { createSqliteClient } from "../../../src/infrastructure/db/sqlite/client.ts";
import { SqliteMetricsRepository } from "../../../src/infrastructure/db/sqlite/repository/SqliteMetricsRepository.ts";

interface RuntimeHealthRow {
  raw_json: string | null;
}

interface QuoteCycleFreshnessPayload {
  totalCycleMs: number;
  quoteComputeMs: number;
  recordQuoteMs: number;
  buildOrdersMs: number;
  reconcileMs: number;
  targetOrderCount: number;
  activeOrderCount: number;
}

const tempDir = join(process.cwd(), "data/test-output/quote-cycle-latency");
const measuredCycles = 30;
const warmupCycles = 5;

describe("quote-cycle latency", () => {
  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  test("measures fixture-backed quoting cycle latency through SQLite runtime health telemetry", async () => {
    const sqliteClient = createSqliteClient(join(tempDir, "metrics.db"));
    const repository = new SqliteMetricsRepository(sqliteClient.db);
    const metrics = new MetricsRecorder(repository, {
      runId: "quote-cycle-latency",
      mode: "paper",
      venue: "bulk",
      capitalMode: "paper",
      market: "BTC-USD",
      strategyName: "avellaneda-stoikov",
      configJson: { fixture: "quote-cycle-latency" },
      gitDirty: false,
    });
    const marketFeed = new FixtureMarketFeed();
    const orderGateway = new FixtureOrderGateway();
    const orderReconciler = new ManagedOrderReconciler(orderGateway, {
      exchangeDropQuoteCooldownMs: 0,
      maxRestingMs: 0,
    });
    const service = new QuotingCycleService(
      marketFeed,
      new FixturePositionRepository(),
      new SimplePmmStrategy(createQuoteEngine()),
      new OrderIntentBuilder(),
      orderReconciler,
      { defaultTimeInForce: "GTC", postOnly: false },
      metrics,
    );

    try {
      await metrics.start();
      for (let cycle = 0; cycle < warmupCycles + measuredCycles; cycle += 1) {
        await service.execute();
        await Bun.sleep(1);
      }
      await metrics.drainAndStop();

      const samples = readQuoteCycleFreshness(sqliteClient).slice(-measuredCycles);
      expect(samples).toHaveLength(measuredCycles);
      expect(samples.every((sample) => sample.activeOrderCount === sample.targetOrderCount)).toBe(
        true,
      );

      const summary = summarizeLatency(samples);
      process.stdout.write(`quote_cycle_latency ${JSON.stringify(summary)}\n`);
      expect(summary.p95TotalCycleMs).toBeLessThanOrEqual(150);
      expect(summary.maxTotalCycleMs).toBeLessThanOrEqual(500);
    } finally {
      await metrics.finish(Date.now(), "completed");
      sqliteClient.sqlite.close();
    }
  });
});

class FixtureMarketFeed {
  private sequence = 0;

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async getSnapshot(): Promise<MarketSnapshot> {
    this.sequence += 1;
    const markPrice = 100_000 + this.sequence;
    const now = Date.now();
    return {
      market: "BTC-USD",
      bestBid: markPrice - 10,
      bestAsk: markPrice + 10,
      microPrice: markPrice,
      markPrice,
      timestamp: now,
      bookUpdatedAt: now,
      tickerUpdatedAt: now,
      marginRatio: 0.4,
    };
  }

  subscribe(_listener: SnapshotListener): () => void {
    return () => {};
  }
}

class FixtureOrderGateway implements IOrderGateway {
  private sequence = 0;

  async place(order: OrderRequest): Promise<PlacedOrder> {
    this.sequence += 1;
    return {
      id: `fixture-order-${this.sequence}`,
      request: order,
      status: "open",
    };
  }

  async cancel(_id: string): Promise<void> {}

  async cancelAll(): Promise<void> {}

  subscribeFills(_listener: FillListener): () => void {
    return () => {};
  }
}

class FixturePositionRepository implements IPositionRepository {
  private position: Position = { qty: 0, avgEntry: 0, unrealizedPnl: 0 };

  async get(): Promise<Position> {
    return this.position;
  }

  async update(_fill: Fill): Promise<Position> {
    return this.position;
  }

  async set(position: Position): Promise<void> {
    this.position = position;
  }
}

function createQuoteEngine(): QuoteEngine {
  return new QuoteEngine(
    new AvellanedaStoikovQuoteModel({ gamma: 0, kappa: 0.02, kInv: 0.01 }),
    new FairPriceCalculator(0.5),
    new VolatilityEstimator(0.2),
    {
      inventoryScale: 1,
      timeHorizonSec: 1,
      minSpreadBps: 2,
      positionSize: 0.001,
      budgetUsd: 100,
    },
  );
}

function readQuoteCycleFreshness(sqliteClient: ReturnType<typeof createSqliteClient>) {
  return sqliteClient.sqlite
    .query<RuntimeHealthRow, []>(
      [
        "SELECT raw_json",
        "FROM runtime_health_events",
        "WHERE run_id = 'quote-cycle-latency'",
        "  AND code = 'quote_cycle_freshness'",
        "ORDER BY observed_at ASC",
      ].join("\n"),
    )
    .all()
    .map((row) => parseQuoteCycleFreshness(row.raw_json));
}

function parseQuoteCycleFreshness(rawJson: string | null): QuoteCycleFreshnessPayload {
  if (rawJson === null) {
    throw new Error("quote_cycle_freshness row is missing raw_json");
  }
  const payload = JSON.parse(rawJson) as QuoteCycleFreshnessPayload;
  if (!Number.isFinite(payload.totalCycleMs)) {
    throw new Error(`invalid quote_cycle_freshness payload: ${rawJson}`);
  }
  return payload;
}

function summarizeLatency(samples: QuoteCycleFreshnessPayload[]) {
  const totalCycleMs = samples.map((sample) => sample.totalCycleMs).sort((a, b) => a - b);
  return {
    samples: samples.length,
    p50TotalCycleMs: percentile(totalCycleMs, 0.5),
    p95TotalCycleMs: percentile(totalCycleMs, 0.95),
    maxTotalCycleMs: totalCycleMs.at(-1) ?? 0,
    maxQuoteComputeMs: Math.max(...samples.map((sample) => sample.quoteComputeMs)),
    maxRecordQuoteMs: Math.max(...samples.map((sample) => sample.recordQuoteMs)),
    maxBuildOrdersMs: Math.max(...samples.map((sample) => sample.buildOrdersMs)),
    maxReconcileMs: Math.max(...samples.map((sample) => sample.reconcileMs)),
  };
}

function percentile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.ceil(sortedValues.length * quantile) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))] ?? 0;
}
