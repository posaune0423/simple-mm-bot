import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { TelemetryEvent } from "../../src/telemetry/Telemetry.ts";
import { createSqliteClient } from "../../src/infrastructure/db/sqlite/client.ts";
import { SqliteTelemetryRepository } from "../../src/infrastructure/db/sqlite/repository/SqliteTelemetryRepository.ts";

describe("SqliteTelemetryRepository", () => {
  const tempDir = join(process.cwd(), "tmp-tests-telemetry");
  const dbPath = join(tempDir, "telemetry.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("stores mode-independent run metadata and typed events", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteTelemetryRepository(client.db);

    await repository.startRun({
      id: "run-1",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      configJson: { mode: "live", venue: "bulk" },
      gitSha: "abc123",
      gitDirty: true,
      startedAt: 1000,
      status: "running",
    });
    const event: TelemetryEvent = {
      id: "event-1",
      runId: "run-1",
      mode: "live",
      venue: "bulk",
      type: "market_snapshot",
      timestamp: 1010,
      market: "BTC-USD",
      payload: {
        bestBid: 99,
        bestAsk: 101,
        midPrice: 100,
        microPrice: 100.25,
        markPrice: 100.5,
        spreadBps: 200,
        topDepth: { bid: 2, ask: 1 },
        imbalance: 0.3333333333333333,
        stalenessMs: 0,
      },
    };

    await repository.recordEvent(event);
    await repository.finishRun("run-1", 1100, "completed");

    const run = await repository.findRun("run-1");
    const events = await repository.findEvents({
      runId: "run-1",
      types: ["market_snapshot"],
      from: 1000,
      to: 1100,
    });

    expect(run).toMatchObject({
      id: "run-1",
      mode: "live",
      venue: "bulk",
      capitalMode: "beta_mock",
      market: "BTC-USD",
      gitSha: "abc123",
      gitDirty: true,
      startedAt: 1000,
      endedAt: 1100,
      status: "completed",
    });
    expect(run?.configJson).toEqual({ mode: "live", venue: "bulk" });
    expect(events).toEqual([event]);
  });
});
