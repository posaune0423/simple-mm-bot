import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createSqliteClient } from "../../src/infrastructure/db/sqlite/client.ts";
import { SqliteTradeRepository } from "../../src/infrastructure/db/sqlite/repository/SqliteTradeRepository.ts";
import { fetchFills } from "../../src/reporting/queries/FillsQuery.ts";

describe("fetchFills", () => {
  const tempDir = join(process.cwd(), "tmp-tests-fills-query");
  const dbPath = join(tempDir, "fills.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("filters by time window and venue, orders ascending", async () => {
    const client = createSqliteClient(dbPath);
    const repo = new SqliteTradeRepository(client.db);

    await repo.save({
      id: "a",
      venue: "hyperliquid",
      market: "ETH",
      side: "buy",
      price: 100,
      qty: 1,
      fee: 0.05,
      tradePnl: 0.2,
      filledAt: 1000,
    });
    await repo.save({
      id: "b",
      venue: "hyperliquid",
      market: "ETH",
      side: "sell",
      price: 101,
      qty: 1,
      fee: 0.05,
      tradePnl: -0.1,
      filledAt: 2000,
    });
    await repo.save({
      id: "c",
      venue: "bulk",
      market: "ETH",
      side: "buy",
      price: 102,
      qty: 1,
      fee: 0.05,
      tradePnl: 0.3,
      filledAt: 3000,
    });
    await repo.save({
      id: "d",
      venue: "hyperliquid",
      market: "ETH",
      side: "buy",
      price: 99,
      qty: 1,
      fee: 0.05,
      tradePnl: 0.1,
      filledAt: 5000,
    });

    const within = await fetchFills({
      db: client.db,
      venue: "hyperliquid",
      periodStart: 1500,
      periodEnd: 4500,
    });
    expect(within.map((f) => f.id)).toEqual(["b"]);

    const withoutVenue = await fetchFills({
      db: client.db,
      periodStart: 0,
      periodEnd: 6000,
    });
    expect(withoutVenue.map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
  });
});
