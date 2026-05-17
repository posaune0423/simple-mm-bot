import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type {
  AccountStateObservationFact,
  OrderLifecycleEventFact,
  SubmittedOrderFact,
} from "../../src/domain/ports/IMetricsRepository.ts";
import { createPostgresClient } from "../../src/infrastructure/db/postgres/client.ts";
import { PostgresMetricsRepository } from "../../src/infrastructure/db/postgres/repository/PostgresMetricsRepository.ts";
import {
  botMarketObservationsTable,
  botOrdersTable,
} from "../../src/infrastructure/db/postgres/schema.ts";

const databaseUrl = Bun.env.TEST_DATABASE_URL ?? Bun.env.DATABASE_URL;
const shouldRun =
  databaseUrl?.startsWith("postgres://") || databaseUrl?.startsWith("postgresql://");
const describePostgres = shouldRun ? describe : describe.skip;

describePostgres("PostgresMetricsRepository", () => {
  let client: ReturnType<typeof createPostgresClient>;
  let repository: PostgresMetricsRepository;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
    }
    client = createPostgresClient(databaseUrl);
    repository = new PostgresMetricsRepository(client.db);
  });

  beforeEach(async () => {
    await client.client`TRUNCATE bot_orders, bot_market_observations`;
  });

  afterAll(async () => {
    await client.client.end();
  });

  test("upserts submitted order lifecycle state for the same order id", async () => {
    const submitted = submittedOrder({
      finalStatus: "submitted",
    });
    const accepted = submittedOrder({
      acceptedAt: 1_700_000_000_025,
      finalStatus: "accepted",
      latencyMs: 25,
      venueOrderId: "venue-order-1",
    });

    await repository.recordSubmittedOrder(submitted);
    await repository.recordSubmittedOrder(accepted);

    const rows = await client.db
      .select()
      .from(botOrdersTable)
      .where(eq(botOrdersTable.id, submitted.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: submitted.id,
      status: "accepted",
      venueOrderId: "venue-order-1",
      acceptedAt: 1_700_000_000_025,
      latencyMs: 25,
    });
  });

  test("stores account equity in context without corrupting mark price", async () => {
    const observation: AccountStateObservationFact = {
      id: "account-observation-1",
      runId: "run-metrics-repo",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1_700_000_010_000,
      balance: 10_000,
      equity: 10_250,
      realizedPnl: 100,
      unrealizedPnl: 150,
      positionQty: 0.25,
      marginRatio: 0.8,
    };

    await repository.recordAccountStateObservation(observation);

    const rows = await client.db
      .select()
      .from(botMarketObservationsTable)
      .where(eq(botMarketObservationsTable.id, observation.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.markPrice).toBeNull();
    expect(rows[0]?.positionQty).toBe(0.25);
    expect(JSON.parse(rows[0]?.contextJson ?? "{}")).toMatchObject({
      balance: 10_000,
      equity: 10_250,
      realizedPnl: 100,
      unrealizedPnl: 150,
      marginRatio: 0.8,
    });
  });

  test("updates an existing submitted order from lifecycle facts", async () => {
    const submitted = submittedOrder({
      finalStatus: "submitted",
    });
    const canceled: OrderLifecycleEventFact = {
      id: "lifecycle-cancel-1",
      runId: submitted.runId,
      venue: submitted.venue,
      market: submitted.market,
      action: "cancel",
      clientOrderId: submitted.clientOrderId,
      venueOrderId: "venue-order-canceled",
      status: "canceled",
      latencyMs: 40,
      observedAt: 1_700_000_000_040,
    };

    await repository.recordSubmittedOrder(submitted);
    await repository.recordOrderLifecycleEvent(canceled);

    const rows = await client.db
      .select()
      .from(botOrdersTable)
      .where(eq(botOrdersTable.clientOrderId, submitted.clientOrderId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: submitted.id,
      status: "canceled",
      venueOrderId: "venue-order-canceled",
      canceledAt: 1_700_000_000_040,
      latencyMs: 40,
      side: "buy",
      quantity: 0.01,
    });
  });
});

function submittedOrder(overrides: Partial<SubmittedOrderFact>): SubmittedOrderFact {
  return {
    id: "submitted-order-1",
    runId: "run-metrics-repo",
    venue: "bulk",
    market: "BTC-USD",
    clientOrderId: "client-order-1",
    intent: "quote",
    side: "buy",
    orderType: "limit",
    limitPrice: 79_000,
    quantity: 0.01,
    timeInForce: "GTC",
    submittedAt: 1_700_000_000_000,
    finalStatus: "submitted",
    ...overrides,
  };
}
