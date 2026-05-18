import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, gte } from "drizzle-orm";

import type { MarketDataBookSnapshot } from "../../src/domain/market-data/MarketDataRecord.ts";
import { createPostgresClient } from "../../src/infrastructure/db/postgres/client.ts";
import { PostgresMarketDataRepository } from "../../src/infrastructure/db/postgres/repository/PostgresMarketDataRepository.ts";
import {
  marketDataOrderBookSnapshotsTable,
  marketDataTickersTable,
  marketDataTradesTable,
} from "../../src/infrastructure/db/postgres/schema.ts";

const databaseUrl = Bun.env.TEST_DATABASE_URL ?? Bun.env.DATABASE_URL;
const shouldRun =
  databaseUrl?.startsWith("postgres://") || databaseUrl?.startsWith("postgresql://");
const describePostgres = shouldRun ? describe : describe.skip;

describePostgres("PostgresMarketDataRepository", () => {
  let client: ReturnType<typeof createPostgresClient>;
  let repository: PostgresMarketDataRepository;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
    }
    client = createPostgresClient(databaseUrl);
    repository = new PostgresMarketDataRepository(client.db);
  });

  beforeEach(async () => {
    await client.client`TRUNCATE target_market_order_books, target_market_trades, target_market_tickers`;
  });

  afterAll(async () => {
    await client.client.end();
  });

  test("inserts book snapshots and can query by venue, symbol, and received_at", async () => {
    const row = book("book-repo-1", 1_700_000_000_001);

    await repository.insertBookSnapshots([row]);

    const rows = await client.db
      .select()
      .from(marketDataOrderBookSnapshotsTable)
      .where(
        and(
          eq(marketDataOrderBookSnapshotsTable.venue, "bulk"),
          eq(marketDataOrderBookSnapshotsTable.symbol, "BTC-USD"),
          gte(marketDataOrderBookSnapshotsTable.receivedAt, row.receivedAt),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ id: row.id, midPrice: 100 }));
  });

  test("inserts trades and duplicate insert does not crash", async () => {
    const row = {
      id: "trade-repo-1",
      venue: "bulk" as const,
      symbol: "BTC-USD",
      tradeId: "venue-trade-1",
      receivedAt: 1_700_000_000_002,
      price: 100,
      quantity: 0.1,
      side: "buy" as const,
      aggressorSide: "buy" as const,
      raw: { source: "test" },
    };

    await repository.insertTrades([row]);
    await repository.insertTrades([row]);

    const rows = await client.db
      .select()
      .from(marketDataTradesTable)
      .where(eq(marketDataTradesTable.id, row.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ price: 100, quantity: 0.1 }));
  });

  test("inserts tickers and duplicate insert does not crash", async () => {
    const row = {
      id: "ticker-repo-1",
      venue: "bulk" as const,
      symbol: "BTC-USD",
      receivedAt: 1_700_000_000_003,
      markPrice: 100,
      indexPrice: 99,
      raw: { source: "test" },
    };

    await repository.insertTickers([row]);
    await repository.insertTickers([row]);

    const rows = await client.db
      .select()
      .from(marketDataTickersTable)
      .where(eq(marketDataTickersTable.id, row.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ markPrice: 100, indexPrice: 99 }));
  });
});

function book(id: string, receivedAt: number): MarketDataBookSnapshot {
  return {
    id,
    venue: "bulk",
    symbol: "BTC-USD",
    receivedAt,
    depth: 1,
    bestBidPrice: 99,
    bestBidSize: 2,
    bestAskPrice: 101,
    bestAskSize: 1,
    midPrice: 100,
    microPrice: 100.33333333333333,
    spreadBps: 200,
    bids: [{ price: 99, quantity: 2 }],
    asks: [{ price: 101, quantity: 1 }],
    raw: { source: "test" },
  };
}
