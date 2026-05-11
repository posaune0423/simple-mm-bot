import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createSqliteClient } from "../../../src/infrastructure/db/sqlite/client.ts";
import { SqliteOhlcvRepository } from "../../../src/infrastructure/db/sqlite/repository/SqliteOhlcvRepository.ts";

describe("SqliteOhlcvRepository", () => {
  const tempDir = join(process.cwd(), "tmp-tests");
  const dbPath = join(tempDir, "ohlcv-repository.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("upserts existing candles for the same market timeframe and timestamp", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteOhlcvRepository(client.db);

    await repository.saveMany([
      {
        market: "BTC-USD",
        timeframe: "1m",
        ts: 1_700_000_000_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 2,
      },
    ]);
    await repository.saveMany([
      {
        market: "BTC-USD",
        timeframe: "1m",
        ts: 1_700_000_000_000,
        open: 100,
        high: 105,
        low: 98,
        close: 104,
        volume: 5,
      },
    ]);

    const rows = await repository.findByRange(
      "BTC-USD",
      "1m",
      1_700_000_000_000,
      1_700_000_000_000,
    );

    expect(rows).toEqual([
      {
        market: "BTC-USD",
        timeframe: "1m",
        ts: 1_700_000_000_000,
        open: 100,
        high: 105,
        low: 98,
        close: 104,
        volume: 5,
      },
    ]);
  });
});
