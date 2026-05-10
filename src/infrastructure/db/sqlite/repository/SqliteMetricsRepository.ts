import { eq, sql } from "drizzle-orm";

import type {
  IQuoteQualityRepository,
  QuoteQualityQuery,
  QuoteSideQuality,
} from "../../../../domain/ports/IQuoteQualityRepository.ts";
import type {
  AccountStateObservationFact,
  IMetricsRepository,
  OrderLifecycleEventFact,
  OrderbookSnapshotFact,
  QuoteDecisionFact,
  RuntimeHealthEventFact,
  SubmittedOrderFact,
  TradeFillFact,
  TradingRunFact,
} from "../../../../domain/ports/IMetricsRepository.ts";
import {
  accountStateObservationsTable,
  orderLifecycleEventsTable,
  orderbookSnapshotsTable,
  quoteDecisionsTable,
  runtimeHealthEventsTable,
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

  async recordRuntimeHealthEvent(event: RuntimeHealthEventFact): Promise<void> {
    const row = serializeRuntimeHealthEvent(event);
    await this.db
      .insert(runtimeHealthEventsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [
          runtimeHealthEventsTable.runId,
          runtimeHealthEventsTable.code,
          runtimeHealthEventsTable.observedAt,
        ],
        set: row,
      });
  }

  async recordQuoteDecision(decision: QuoteDecisionFact): Promise<void> {
    const row = serializeQuoteDecision(decision);
    await this.db
      .insert(quoteDecisionsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [
          quoteDecisionsTable.runId,
          quoteDecisionsTable.quoteCycleId,
          quoteDecisionsTable.side,
          quoteDecisionsTable.level,
        ],
        set: row,
      });
  }

  async recordOrderLifecycleEvent(event: OrderLifecycleEventFact): Promise<void> {
    const row = serializeOrderLifecycleEvent(event);
    await this.db.insert(orderLifecycleEventsTable).values(row).onConflictDoUpdate({
      target: orderLifecycleEventsTable.id,
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
        WITH recent AS (
          SELECT *
          FROM (
            SELECT
              f.id,
              f.run_id,
              f.market,
              f.side,
              f.price,
              f.filled_at
            FROM trade_fills f
            WHERE f.market = ${query.market}
              AND f.side = 'buy'
              AND EXISTS (
                SELECT 1
                FROM submitted_orders o
                WHERE o.run_id = f.run_id
                  AND o.intent = 'quote'
                  AND (
                    o.id = f.submitted_order_id
                    OR (f.venue_order_id IS NOT NULL AND o.venue_order_id = f.venue_order_id)
                  )
              )
            ORDER BY f.filled_at DESC, f.id DESC
            LIMIT ${query.lookbackFills}
          )
          UNION ALL
          SELECT *
          FROM (
            SELECT
              f.id,
              f.run_id,
              f.market,
              f.side,
              f.price,
              f.filled_at
            FROM trade_fills f
            WHERE f.market = ${query.market}
              AND f.side = 'sell'
              AND EXISTS (
                SELECT 1
                FROM submitted_orders o
                WHERE o.run_id = f.run_id
                  AND o.intent = 'quote'
                  AND (
                    o.id = f.submitted_order_id
                    OR (f.venue_order_id IS NOT NULL AND o.venue_order_id = f.venue_order_id)
                  )
              )
            ORDER BY f.filled_at DESC, f.id DESC
            LIMIT ${query.lookbackFills}
          )
        ),
        snapshots AS (
          SELECT
            r.side,
            r.price,
            r.filled_at,
            (
              SELECT s.mid_price
              FROM orderbook_snapshots s
              WHERE s.run_id = r.run_id
                AND s.market = r.market
                AND s.observed_at >= r.filled_at + 5000
                AND s.observed_at <= r.filled_at + 10000
              ORDER BY s.observed_at ASC
              LIMIT 1
            ) AS mid_5s,
            (
              SELECT s.mid_price
              FROM orderbook_snapshots s
              WHERE s.run_id = r.run_id
                AND s.market = r.market
                AND s.observed_at >= r.filled_at + 30000
                AND s.observed_at <= r.filled_at + 45000
              ORDER BY s.observed_at ASC
              LIMIT 1
            ) AS mid_30s,
            (
              SELECT s.mid_price
              FROM orderbook_snapshots s
              WHERE s.run_id = r.run_id
                AND s.market = r.market
                AND s.observed_at >= r.filled_at + 300000
                AND s.observed_at <= r.filled_at + 330000
              ORDER BY s.observed_at ASC
              LIMIT 1
            ) AS mid_300s
          FROM recent r
        )
        SELECT
          side,
          CASE
            WHEN mid_5s IS NULL THEN NULL
            WHEN side = 'buy' THEN ((mid_5s - price) / price) * 10000
            ELSE ((price - mid_5s) / price) * 10000
          END AS markout_5s_bps,
          CASE
            WHEN mid_30s IS NULL THEN NULL
            WHEN side = 'buy' THEN ((mid_30s - price) / price) * 10000
            ELSE ((price - mid_30s) / price) * 10000
          END AS markout_30s_bps,
          CASE
            WHEN mid_300s IS NULL THEN NULL
            WHEN side = 'buy' THEN ((mid_300s - price) / price) * 10000
            ELSE ((price - mid_300s) / price) * 10000
          END AS markout_300s_bps
        FROM snapshots
        ORDER BY side ASC, filled_at DESC
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

function serializeRuntimeHealthEvent(
  event: RuntimeHealthEventFact,
): typeof runtimeHealthEventsTable.$inferInsert {
  return {
    ...event,
    rawJson: stringifyOptional(event.rawJson),
  };
}

function serializeQuoteDecision(
  decision: QuoteDecisionFact,
): typeof quoteDecisionsTable.$inferInsert {
  return {
    id: decision.id,
    runId: decision.runId,
    venue: decision.venue,
    market: decision.market,
    quoteCycleId: decision.quoteCycleId,
    side: decision.side,
    level: decision.level,
    intent: decision.intent,
    price: decision.price,
    quantity: decision.quantity,
    fairPrice: decision.fairPrice,
    sigma: decision.sigma,
    policy: decision.policy,
    positionQty: decision.positionQty,
    midPrice: decision.midPrice,
    microPrice: decision.microPrice,
    markPrice: decision.markPrice,
    spreadBps: decision.spreadBps,
    stalenessMs: decision.stalenessMs,
    controlReasonsJson: JSON.stringify(decision.controlReasons),
    createdAt: decision.createdAt,
    rawJson: stringifyOptional(decision.rawJson),
  };
}

function serializeOrderLifecycleEvent(
  event: OrderLifecycleEventFact,
): typeof orderLifecycleEventsTable.$inferInsert {
  return {
    ...event,
    rawJson: stringifyOptional(event.rawJson),
  };
}

function stringifyOptional(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}
