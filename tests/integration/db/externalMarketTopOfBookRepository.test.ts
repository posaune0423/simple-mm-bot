import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, desc, eq, gte } from "drizzle-orm";

import type { ExternalMarketTopOfBookRecord } from "../../../src/domain/external-market/ExternalMarketTypes.ts";
import { createPostgresClient } from "../../../src/infrastructure/db/postgres/client.ts";
import { PostgresExternalMarketRepository } from "../../../src/infrastructure/db/postgres/repository/PostgresExternalMarketRepository.ts";
import { externalMarketTopOfBookTable } from "../../../src/infrastructure/db/postgres/schema.ts";

const databaseUrl = Bun.env.TEST_DATABASE_URL ?? Bun.env.DATABASE_URL;
const shouldRun =
  databaseUrl?.startsWith("postgres://") || databaseUrl?.startsWith("postgresql://");
const describePostgres = shouldRun ? describe : describe.skip;

describePostgres("PostgresExternalMarketRepository", () => {
  let client: ReturnType<typeof createPostgresClient>;
  let repository: PostgresExternalMarketRepository;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
    }
    client = createPostgresClient(databaseUrl);
    repository = new PostgresExternalMarketRepository(client.db);
  });

  beforeEach(async () => {
    await client.client`TRUNCATE external_market_top_of_book, external_market_trades, external_market_tickers`;
  });

  afterAll(async () => {
    await client.client.end();
  });

  test("batch inserts top-of-book rows and duplicate insert does not crash", async () => {
    const row = topOfBook("external-bbo-1", 1_700_000_000_001);

    await repository.insertTopOfBook([row]);
    await repository.insertTopOfBook([row]);

    const rows = await client.db
      .select()
      .from(externalMarketTopOfBookTable)
      .where(eq(externalMarketTopOfBookTable.id, row.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ midPrice: 100, spreadBps: 200 }));
  });

  test("queries latest rows by venue, symbol, and received_at", async () => {
    const first = topOfBook("external-bbo-1", 1_700_000_000_001);
    const second = topOfBook("external-bbo-2", 1_700_000_000_002);

    await repository.insertTopOfBook([first, second]);

    const rows = await client.db
      .select()
      .from(externalMarketTopOfBookTable)
      .where(
        and(
          eq(externalMarketTopOfBookTable.venue, "binance_usdm"),
          eq(externalMarketTopOfBookTable.symbol, "BTCUSDT"),
          gte(externalMarketTopOfBookTable.receivedAt, first.receivedAt),
        ),
      )
      .orderBy(desc(externalMarketTopOfBookTable.receivedAt))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(second.id);
  });
});

function topOfBook(id: string, receivedAt: number): ExternalMarketTopOfBookRecord {
  return {
    id,
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    receivedAt,
    bidPrice: 99,
    bidSize: 2,
    askPrice: 101,
    askSize: 1,
    midPrice: 100,
    microPrice: 100.33333333333333,
    spreadBps: 200,
    raw: { source: "test" },
  };
}
