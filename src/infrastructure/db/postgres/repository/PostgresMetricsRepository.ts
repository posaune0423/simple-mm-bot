import { eq } from "drizzle-orm";

import type {
  AccountStateObservationFact,
  IMetricsRepository,
  OrderbookSnapshotFact,
  SubmittedOrderFact,
  TradeFillFact,
  TradingRunFact,
} from "../../../../domain/ports/IMetricsRepository.ts";
import {
  accountStateObservationsTable,
  orderbookSnapshotsTable,
  submittedOrdersTable,
  tradeFillsTable,
  tradingRunsTable,
} from "../schema.ts";

type PostgresDb = ReturnType<typeof import("../client.ts").createPostgresClient>["db"];
type TradingRunRow = typeof tradingRunsTable.$inferSelect;

export class PostgresMetricsRepository implements IMetricsRepository {
  constructor(private readonly db: PostgresDb) {}

  async startRun(run: TradingRunFact): Promise<void> {
    await this.db
      .insert(tradingRunsTable)
      .values(serializeRun(run))
      .onConflictDoUpdate({
        target: tradingRunsTable.id,
        set: serializeRun(run),
      });
  }

  async finishRun(
    runId: string,
    endedAt: number,
    status: TradingRunFact["status"],
    stopReason?: string,
  ): Promise<void> {
    await this.db
      .update(tradingRunsTable)
      .set({ endedAt, status, stopReason })
      .where(eq(tradingRunsTable.id, runId));
  }

  async recordOrderbookSnapshot(snapshot: OrderbookSnapshotFact): Promise<void> {
    const row = serializeOrderbookSnapshot(snapshot);
    await this.db
      .insert(orderbookSnapshotsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [
          orderbookSnapshotsTable.runId,
          orderbookSnapshotsTable.market,
          orderbookSnapshotsTable.observedAt,
        ],
        set: row,
      });
  }

  async recordSubmittedOrder(order: SubmittedOrderFact): Promise<void> {
    const row = serializeSubmittedOrder(order);
    await this.db.insert(submittedOrdersTable).values(row).onConflictDoUpdate({
      target: submittedOrdersTable.id,
      set: row,
    });
  }

  async recordTradeFill(fill: TradeFillFact): Promise<void> {
    const row = serializeTradeFill(fill);
    await this.db
      .insert(tradeFillsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [tradeFillsTable.venue, tradeFillsTable.venueFillId],
        set: row,
      });
  }

  async recordAccountStateObservation(observation: AccountStateObservationFact): Promise<void> {
    const row = serializeAccountStateObservation(observation);
    await this.db
      .insert(accountStateObservationsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [
          accountStateObservationsTable.runId,
          accountStateObservationsTable.market,
          accountStateObservationsTable.observedAt,
        ],
        set: row,
      });
  }

  async findRun(runId: string): Promise<TradingRunFact | null> {
    const rows = await this.db
      .select()
      .from(tradingRunsTable)
      .where(eq(tradingRunsTable.id, runId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : deserializeRun(row);
  }
}

function serializeRun(run: TradingRunFact): typeof tradingRunsTable.$inferInsert {
  return {
    id: run.id,
    mode: run.mode,
    venue: run.venue,
    market: run.market,
    capitalMode: run.capitalMode,
    strategyName: run.strategyName,
    configJson: JSON.stringify(run.configJson),
    gitSha: run.gitSha,
    gitDirty: run.gitDirty,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    stopReason: run.stopReason,
  };
}

function deserializeRun(row: TradingRunRow): TradingRunFact {
  return {
    id: row.id,
    mode: row.mode as TradingRunFact["mode"],
    venue: row.venue,
    market: row.market,
    capitalMode: row.capitalMode as TradingRunFact["capitalMode"],
    strategyName: row.strategyName,
    configJson: JSON.parse(row.configJson),
    gitSha: row.gitSha ?? undefined,
    gitDirty: row.gitDirty,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    status: row.status as TradingRunFact["status"],
    stopReason: row.stopReason ?? undefined,
  };
}

function serializeOrderbookSnapshot(
  snapshot: OrderbookSnapshotFact,
): typeof orderbookSnapshotsTable.$inferInsert {
  return {
    ...snapshot,
    rawJson: stringifyOptional(snapshot.rawJson),
  };
}

function serializeSubmittedOrder(
  order: SubmittedOrderFact,
): typeof submittedOrdersTable.$inferInsert {
  return {
    ...order,
    rawJson: stringifyOptional(order.rawJson),
  };
}

function serializeTradeFill(fill: TradeFillFact): typeof tradeFillsTable.$inferInsert {
  return {
    ...fill,
    rawJson: stringifyOptional(fill.rawJson),
  };
}

function serializeAccountStateObservation(
  observation: AccountStateObservationFact,
): typeof accountStateObservationsTable.$inferInsert {
  return {
    ...observation,
    rawJson: stringifyOptional(observation.rawJson),
  };
}

function stringifyOptional(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}
