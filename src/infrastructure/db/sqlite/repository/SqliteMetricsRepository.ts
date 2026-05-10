import { eq, sql } from "drizzle-orm";

import type {
  IQuoteQualityRepository,
  QuoteQualityQuery,
  QuoteSideQuality,
} from "../../../../domain/ports/IQuoteQualityRepository.ts";
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

type SqliteDb = ReturnType<typeof import("../client.ts").createSqliteClient>["db"];
type TradingRunRow = typeof tradingRunsTable.$inferSelect;
type MarkoutRow = {
  side: "buy" | "sell";
  markout_5s_bps: number | null;
  markout_30s_bps: number | null;
  markout_300s_bps: number | null;
};

export class SqliteMetricsRepository implements IMetricsRepository, IQuoteQualityRepository {
  constructor(private readonly db: SqliteDb) {}

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

  async getRecentSideQuality(query: QuoteQualityQuery): Promise<QuoteSideQuality[]> {
    const rows = this.db.all<MarkoutRow>(
      sql`
        WITH ranked AS (
          SELECT
            side,
            markout_5s_bps,
            markout_30s_bps,
            markout_300s_bps,
            ROW_NUMBER() OVER (PARTITION BY side ORDER BY filled_at DESC, fill_id DESC) AS side_rank
          FROM v_fill_markouts
          WHERE market = ${query.market}
            AND side IN ('buy', 'sell')
        )
        SELECT side, markout_5s_bps, markout_30s_bps, markout_300s_bps
        FROM ranked
        WHERE side_rank <= ${query.lookbackFills}
        ORDER BY side ASC, side_rank ASC
      `,
    );

    return (["buy", "sell"] as const).flatMap((side) => {
      const sideRows = rows.filter((row) => row.side === side);
      if (sideRows.length === 0) {
        return [];
      }
      return [
        {
          side,
          horizons: query.horizonsSec.map((horizonSec) => aggregateHorizon(sideRows, horizonSec)),
        },
      ];
    });
  }
}

function aggregateHorizon(rows: MarkoutRow[], horizonSec: number) {
  const values = rows
    .map((row) => markoutForHorizon(row, horizonSec))
    .filter((value): value is number => value !== null);
  return {
    horizonSec,
    sampleCount: values.length,
    averageMarkoutBps:
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function markoutForHorizon(row: MarkoutRow, horizonSec: number): number | null {
  switch (horizonSec) {
    case 5:
      return row.markout_5s_bps;
    case 30:
      return row.markout_30s_bps;
    case 300:
      return row.markout_300s_bps;
    default:
      return null;
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
