import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createSqliteClient } from "../../../src/infrastructure/db/sqlite/client.ts";
import { SqliteMetricsRepository } from "../../../src/infrastructure/db/sqlite/repository/SqliteMetricsRepository.ts";
import { fetchReportFills } from "../../../src/lib/reporting/queries/MetricsFactQuery.ts";

describe("fetchReportFills", () => {
  const tempDir = join(process.cwd(), "tmp-tests-metrics-fact-query");
  const dbPath = join(tempDir, "metrics.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("reads ordered report fills from trade_fills and markout views", async () => {
    const client = createSqliteClient(dbPath);
    const repo = new SqliteMetricsRepository(client.db);

    await repo.startRun({
      id: "run-1",
      mode: "paper",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "paper",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 0,
      status: "running",
    });
    await repo.recordOrderbookSnapshot({
      id: "snap-fill",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      bestBid: 99,
      bestAsk: 101,
      midPrice: 100,
      microPrice: 100,
      markPrice: 100,
      spreadBps: 200,
      stalenessMs: 0,
    });
    await repo.recordOrderbookSnapshot({
      id: "snap-5s",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 6000,
      bestBid: 100,
      bestAsk: 102,
      midPrice: 101,
      microPrice: 101,
      markPrice: 101,
      spreadBps: 198,
      stalenessMs: 0,
    });
    await repo.recordOrderbookSnapshot({
      id: "snap-30s",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 31000,
      bestBid: 98,
      bestAsk: 100,
      midPrice: 99,
      microPrice: 99,
      markPrice: 99,
      spreadBps: 202,
      stalenessMs: 0,
    });
    await repo.recordTradeFill({
      id: "fill-1",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "venue-fill-1",
      venueOrderId: "quote-cycle:bid",
      side: "buy",
      price: 100,
      quantity: 2,
      fee: 0.05,
      tradePnl: 0.4,
      makerTaker: "maker",
      filledAt: 1000,
    });

    const fills = await fetchReportFills({
      sqlite: client.sqlite,
      venue: "bulk",
      periodStart: 0,
      periodEnd: 40000,
    });

    expect(fills).toEqual([
      expect.objectContaining({
        id: "fill-1",
        quoteId: "quote-cycle:bid",
        qty: 2,
        markPriceAtFill: 100,
        markPrice5s: 101,
        markPrice30s: 99,
      }),
    ]);
    client.sqlite.close();
  });
});
