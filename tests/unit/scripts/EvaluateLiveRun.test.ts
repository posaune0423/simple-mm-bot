import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { loadEvaluationResult, normalizeQuoteCycleId } from "../../../scripts/evaluateLiveRun.ts";
import { createSqliteClient } from "../../../src/infrastructure/db/sqlite/client.ts";
import { SqliteMetricsRepository } from "../../../src/infrastructure/db/sqlite/repository/SqliteMetricsRepository.ts";

describe("evaluateLiveRun", () => {
  const tempDir = join(process.cwd(), "tmp-tests-evaluate-live-run");
  const dbPath = join(tempDir, "metrics.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("normalizes ladder client order ids by quote cycle and level", () => {
    expect(normalizeQuoteCycleId("cycle-1:bid")).toBe("cycle-1");
    expect(normalizeQuoteCycleId("cycle-1:ask")).toBe("cycle-1");
    expect(normalizeQuoteCycleId("cycle-1:bid:0")).toBe("cycle-1:0");
    expect(normalizeQuoteCycleId("cycle-1:ask:0")).toBe("cycle-1:0");
    expect(normalizeQuoteCycleId("cycle-1:bid:12")).toBe("cycle-1:12");
    expect(normalizeQuoteCycleId("cycle-1:ask:12")).toBe("cycle-1:12");
  });

  test("computes quoted spread diagnostics from ladder quote pairs", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);
    const runId = "run-ladder-spread";

    await repository.startRun({
      id: runId,
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "bulk-beta-leaderboard",
      configJson: {},
      gitDirty: false,
      startedAt: 1,
      endedAt: 2,
      status: "completed",
    });
    await repository.recordOrderbookSnapshot({
      id: "snapshot-1",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1,
      bestBid: 99_990,
      bestAsk: 100_010,
      midPrice: 100_000,
      microPrice: 100_000,
      markPrice: 100_000,
      spreadBps: 2,
      stalenessMs: 0,
    });

    for (const order of [
      { id: "bid-0", clientOrderId: "cycle-1:bid:0", side: "buy" as const, price: 99_920 },
      { id: "ask-0", clientOrderId: "cycle-1:ask:0", side: "sell" as const, price: 100_080 },
      { id: "bid-1", clientOrderId: "cycle-1:bid:1", side: "buy" as const, price: 99_700 },
      { id: "ask-1", clientOrderId: "cycle-1:ask:1", side: "sell" as const, price: 100_300 },
    ]) {
      await repository.recordSubmittedOrder({
        id: order.id,
        runId,
        venue: "bulk",
        market: "BTC-USD",
        clientOrderId: order.clientOrderId,
        intent: "quote",
        side: order.side,
        orderType: "limit",
        limitPrice: order.price,
        quantity: 0.001,
        timeInForce: "ALO",
        submittedAt: 1,
        acceptedAt: 1,
        finalStatus: "accepted",
      });
    }

    const result = loadEvaluationResult(dbPath, runId);
    const level0SpreadBps = ((100_080 - 99_920) / 99_920) * 10_000;
    const level1SpreadBps = ((100_300 - 99_700) / 99_700) * 10_000;

    expect(result.evaluation.markouts.spreadCaptureBps).toBeCloseTo(
      (level0SpreadBps + level1SpreadBps) / 2,
      4,
    );
    client.sqlite.close();
  });

  test("loads multi-horizon adverse selection and maker ratio from fills", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);
    const runId = "run-multi-horizon";

    await repository.startRun({
      id: runId,
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "bulk-beta-leaderboard",
      configJson: {},
      gitDirty: false,
      startedAt: 1_000,
      endedAt: 301_000,
      status: "completed",
    });

    for (const snapshot of [
      { id: "fill", observedAt: 1_000, midPrice: 100 },
      { id: "five", observedAt: 6_000, midPrice: 99 },
      { id: "thirty", observedAt: 31_000, midPrice: 101 },
      { id: "three-hundred", observedAt: 301_000, midPrice: 98 },
    ]) {
      await repository.recordOrderbookSnapshot({
        id: snapshot.id,
        runId,
        venue: "bulk",
        market: "BTC-USD",
        observedAt: snapshot.observedAt,
        bestBid: snapshot.midPrice - 0.5,
        bestAsk: snapshot.midPrice + 0.5,
        midPrice: snapshot.midPrice,
        microPrice: snapshot.midPrice,
        markPrice: snapshot.midPrice,
        spreadBps: 100,
        stalenessMs: 0,
      });
    }

    await repository.recordSubmittedOrder({
      id: "maker-order",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "cycle:bid:0",
      venueOrderId: "maker-venue-order",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      limitPrice: 100,
      quantity: 1,
      timeInForce: "GTC",
      submittedAt: 900,
      acceptedAt: 950,
      finalStatus: "filled",
    });
    await repository.recordQuoteDecision({
      id: "maker-quote-decision",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      quoteCycleId: "cycle",
      side: "buy",
      level: 0,
      intent: "reduce",
      price: 100,
      quantity: 1,
      fairPrice: 100,
      sigma: 0,
      policy: "GTC",
      positionQty: -0.5,
      midPrice: 100,
      microPrice: 100,
      markPrice: 100,
      spreadBps: 100,
      stalenessMs: 0,
      controlReasons: [],
      createdAt: 900,
    });
    await repository.recordSubmittedOrder({
      id: "taker-order",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "cycle:ask:0",
      venueOrderId: "taker-venue-order",
      intent: "quote",
      side: "sell",
      orderType: "limit",
      limitPrice: 100,
      quantity: 1,
      timeInForce: "GTC",
      submittedAt: 900,
      acceptedAt: 950,
      finalStatus: "filled",
    });

    await repository.recordTradeFill({
      id: "maker-fill",
      runId,
      submittedOrderId: "maker-order",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "maker-fill",
      venueOrderId: "maker-venue-order",
      side: "buy",
      price: 100,
      quantity: 1,
      fee: 0,
      tradePnl: 1,
      makerTaker: "maker",
      filledAt: 1_000,
    });
    await repository.recordTradeFill({
      id: "taker-fill",
      runId,
      submittedOrderId: "taker-order",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "taker-fill",
      venueOrderId: "taker-venue-order",
      side: "sell",
      price: 100,
      quantity: 3,
      fee: 0,
      tradePnl: 1,
      makerTaker: "taker",
      filledAt: 1_000,
    });
    await repository.recordAccountStateObservation({
      id: "account-1",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1_000,
      positionQty: -0.5,
      marginRatio: 0.42,
    });
    await repository.recordAccountStateObservation({
      id: "account-2",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 2_000,
      positionQty: 0.25,
      marginRatio: 0.37,
    });
    await repository.recordSubmittedOrder({
      id: "reduce-order",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "cycle:reduce",
      venueOrderId: "reduce-venue-order",
      intent: "reduce",
      side: "buy",
      orderType: "market",
      quantity: 0.1,
      timeInForce: "IOC",
      submittedAt: 1_100,
      finalStatus: "filled",
    });
    await repository.recordSubmittedOrder({
      id: "close-order",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "cycle:close",
      venueOrderId: "close-venue-order",
      intent: "close",
      side: "sell",
      orderType: "market",
      quantity: 0.1,
      timeInForce: "IOC",
      submittedAt: 1_200,
      finalStatus: "filled",
    });

    const result = loadEvaluationResult(dbPath, runId);

    expect(result.evaluation.dataHealth.markoutCoverageByHorizon["5s"]).toEqual({
      observed: 2,
      total: 2,
      coverage: 1,
    });
    expect(result.evaluation.dataHealth.markoutCoverageByHorizon["30s"]).toEqual({
      observed: 2,
      total: 2,
      coverage: 1,
    });
    expect(result.evaluation.dataHealth.markoutCoverageByHorizon["300s"]).toEqual({
      observed: 2,
      total: 2,
      coverage: 1,
    });
    expect(result.evaluation.markouts.adverseSelectionRate5s).toBe(0.5);
    expect(result.evaluation.markouts.adverseSelectionRate30s).toBe(0.5);
    expect(result.evaluation.markouts.adverseSelectionRate300s).toBe(0.5);
    expect(result.evaluation.markouts.vw5sBps).toBeCloseTo(50);
    expect(result.evaluation.markouts.vw30sBps).toBeCloseTo(-50);
    expect(result.evaluation.markouts.vw300sBps).toBeCloseTo(100);
    expect(result.evaluation.markouts.tail30sBps.p1).toBeCloseTo(-100);
    expect(result.evaluation.orderQuality.makerRatio).toBe(0.5);
    expect(result.evaluation.orderQuality.avgQuoteAgeMs).toBe(100);
    expect(result.evaluation.inventory.avgAbsPosition).toBe(0.375);
    expect(result.evaluation.inventory.maxAbsPosition).toBe(0.5);
    expect(result.evaluation.inventory.reduceCount).toBe(1);
    expect(result.evaluation.inventory.hardReduceCount).toBe(1);
    expect(result.evaluation.inventory.minMarginRatio).toBe(0.37);
    expect(result.bucketEvidence.sideIntent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucket: "sell:quote",
          fillCount: 1,
          notionalUsd: 300,
          netPnl: 1,
        }),
        expect.objectContaining({
          bucket: "buy:reduce",
          fillCount: 1,
          notionalUsd: 100,
          netPnl: 1,
        }),
      ]),
    );
    expect(result.bucketEvidence.quoteLevel).toEqual([
      expect.objectContaining({
        bucket: "level_0",
        fillCount: 2,
        notionalUsd: 400,
      }),
    ]);
    expect(result.bucketEvidence.quoteAge).toEqual([
      expect.objectContaining({
        bucket: "<250ms",
        fillCount: 2,
        p1Markout30sBps: -100,
        p5Markout30sBps: -100,
        avgOrderLiveMs: 100,
      }),
    ]);
    client.sqlite.close();
  });

  test("keeps missing long-horizon markout as unavailable instead of zero", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);
    const runId = "run-missing-300s";

    await repository.startRun({
      id: runId,
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "bulk-beta-leaderboard",
      configJson: {},
      gitDirty: false,
      startedAt: 1_000,
      endedAt: 40_000,
      status: "completed",
    });

    for (const snapshot of [
      { id: "fill", observedAt: 1_000, midPrice: 100 },
      { id: "five", observedAt: 6_000, midPrice: 101 },
      { id: "thirty", observedAt: 31_000, midPrice: 102 },
    ]) {
      await repository.recordOrderbookSnapshot({
        id: snapshot.id,
        runId,
        venue: "bulk",
        market: "BTC-USD",
        observedAt: snapshot.observedAt,
        bestBid: snapshot.midPrice - 0.5,
        bestAsk: snapshot.midPrice + 0.5,
        midPrice: snapshot.midPrice,
        microPrice: snapshot.midPrice,
        markPrice: snapshot.midPrice,
        spreadBps: 100,
        stalenessMs: 0,
      });
    }

    await repository.recordTradeFill({
      id: "fill-no-300s",
      runId,
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "fill-no-300s",
      side: "buy",
      price: 100,
      quantity: 1,
      fee: 0,
      tradePnl: 1,
      makerTaker: "maker",
      filledAt: 1_000,
    });

    const result = loadEvaluationResult(dbPath, runId);

    expect(result.evaluation.dataHealth.markoutCoverageByHorizon["5s"].coverage).toBe(1);
    expect(result.evaluation.dataHealth.markoutCoverageByHorizon["30s"].coverage).toBe(1);
    expect(result.evaluation.dataHealth.markoutCoverageByHorizon["300s"]).toEqual({
      observed: 0,
      total: 1,
      coverage: 0,
    });
    expect(result.evaluation.markouts.avg300sBps).toBeNull();
    expect(result.evaluation.markouts.adverseSelectionRate300s).toBeNull();
    expect(result.evaluation.issueSignals).toContain("low_markout_300s_coverage");
    client.sqlite.close();
  });

  test("flags failed runs as lifecycle issues for design issue planning", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);
    const runId = "run-failed-before-orders";

    await repository.startRun({
      id: runId,
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "bulk-beta-leaderboard",
      configJson: { quoteEngine: { sizing: { budgetUsd: 100_000 } } },
      gitSha: "abc123",
      gitDirty: true,
      startedAt: 1_000,
      endedAt: 2_000,
      status: "failed",
      stopReason: "runtime_error",
    });

    const result = loadEvaluationResult(dbPath, runId);

    expect(result.run.configJson).toEqual({ quoteEngine: { sizing: { budgetUsd: 100_000 } } });
    expect(result.run.gitSha).toBe("abc123");
    expect(result.run.gitDirty).toBe(true);
    expect(result.run.stopReason).toBe("runtime_error");
    expect(result.evaluation.issueSignals).toContain("order_lifecycle_inconsistency");
    client.sqlite.close();
  });

  test("aggregates quote freshness telemetry from runtime health events", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);
    const runId = "run-quote-freshness";

    await repository.startRun({
      id: runId,
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "bulk-beta-leaderboard",
      configJson: { bot: { intervalMs: 100 } },
      gitDirty: false,
      startedAt: 1_000,
      endedAt: 2_000,
      status: "completed",
    });

    for (const [index, rawJson] of [
      {
        totalRefreshMs: 40,
        qualityGateMs: 4,
        recordQuoteMs: 8,
        reconcileMs: 12,
        bookAgeMsAtDecision: 30,
        midMoveDuringRefreshBps: -1,
      },
      {
        totalRefreshMs: 120,
        qualityGateMs: 10,
        recordQuoteMs: 20,
        reconcileMs: 50,
        bookAgeMsAtDecision: 90,
        midMoveDuringRefreshBps: 3,
      },
      {
        totalRefreshMs: 80,
        qualityGateMs: 6,
        recordQuoteMs: 12,
        reconcileMs: 20,
        bookAgeMsAtDecision: 60,
        midMoveDuringRefreshBps: -5,
      },
    ].entries()) {
      await repository.recordRuntimeHealthEvent({
        id: `freshness-${index}`,
        runId,
        venue: "bulk",
        market: "BTC-USD",
        observedAt: 1_000 + index,
        level: "info",
        code: "quote_cycle_freshness",
        message: "Quote cycle freshness measured",
        rawJson,
      });
    }

    const result = loadEvaluationResult(dbPath, runId);

    expect(result.evaluation.runtimeHealth.quoteFreshness).toEqual({
      sampleCount: 3,
      totalRefreshMsP50: 80,
      totalRefreshMsP95: 120,
      totalRefreshMsMax: 120,
      qualityGateMsP95: 10,
      recordQuoteMsP95: 20,
      reconcileMsP95: 50,
      bookAgeMsAtDecisionP95: 90,
      midMoveDuringRefreshBpsP95Abs: 5,
      slowCycleRate: 1 / 3,
    });
    client.sqlite.close();
  });

  test("keeps quote freshness empty when runtime health telemetry is missing", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);
    const runId = "run-no-quote-freshness";

    await repository.startRun({
      id: runId,
      mode: "paper",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "paper",
      strategyName: "bulk-beta-leaderboard",
      configJson: {},
      gitDirty: false,
      startedAt: 1_000,
      endedAt: 2_000,
      status: "completed",
    });

    const result = loadEvaluationResult(dbPath, runId);

    expect(result.evaluation.runtimeHealth.quoteFreshness).toEqual({
      sampleCount: 0,
      totalRefreshMsP50: null,
      totalRefreshMsP95: null,
      totalRefreshMsMax: null,
      qualityGateMsP95: null,
      recordQuoteMsP95: null,
      reconcileMsP95: null,
      bookAgeMsAtDecisionP95: null,
      midMoveDuringRefreshBpsP95Abs: null,
      slowCycleRate: null,
    });
    client.sqlite.close();
  });
});
