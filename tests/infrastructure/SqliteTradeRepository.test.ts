import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createSqliteClient } from "../../src/infrastructure/db/sqlite/client.ts";
import { SqliteTradeRepository } from "../../src/infrastructure/db/sqlite/repository/SqliteTradeRepository.ts";

describe("SqliteTradeRepository", () => {
  const tempDir = join(process.cwd(), "tmp-tests");
  const dbPath = join(tempDir, "trade-repository.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("saves and queries fills", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteTradeRepository(client.db);

    await repository.save({
      id: "fill-1",
      venue: "paper",
      market: "ETH",
      side: "buy",
      price: 100,
      qty: 1,
      fee: 0.1,
      tradePnl: 0.5,
      filledAt: 1000,
    });

    const all = await repository.findAll();
    const ranged = await repository.findByRange(900, 1100);

    expect(all).toHaveLength(1);
    expect(ranged).toHaveLength(1);
    expect(all[0]?.id).toBe("fill-1");
  });
});
