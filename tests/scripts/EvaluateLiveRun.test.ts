import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { loadEvaluationResult, normalizeQuoteCycleId } from "../../scripts/evaluateLiveRun.ts";
import { createSqliteClient } from "../../src/infrastructure/db/sqlite/client.ts";
import { SqliteMetricsRepository } from "../../src/infrastructure/db/sqlite/repository/SqliteMetricsRepository.ts";

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
});
