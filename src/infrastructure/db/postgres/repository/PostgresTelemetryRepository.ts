import { and, between, eq, inArray } from "drizzle-orm";

import type { AppMode } from "../../../../config.ts";
import type { CapitalMode, TelemetryEvent, TelemetryRun } from "../../../../telemetry/Telemetry.ts";
import type {
  ITelemetryRepository,
  TelemetryEventQuery,
} from "../../../../telemetry/ITelemetryRepository.ts";
import { telemetryEventsTable, telemetryRunsTable } from "../schema.ts";

type PostgresDb = ReturnType<typeof import("../client.ts").createPostgresClient>["db"];
type TelemetryRunRow = typeof telemetryRunsTable.$inferSelect;
type TelemetryEventRow = typeof telemetryEventsTable.$inferSelect;

export class PostgresTelemetryRepository implements ITelemetryRepository {
  constructor(private readonly db: PostgresDb) {}

  async startRun(run: TelemetryRun): Promise<void> {
    await this.db
      .insert(telemetryRunsTable)
      .values(serializeRun(run))
      .onConflictDoUpdate({
        target: telemetryRunsTable.id,
        set: serializeRun(run),
      });
  }

  async finishRun(runId: string, endedAt: number, status: TelemetryRun["status"]): Promise<void> {
    await this.db
      .update(telemetryRunsTable)
      .set({ endedAt, status })
      .where(eq(telemetryRunsTable.id, runId));
  }

  async recordEvent(event: TelemetryEvent): Promise<void> {
    await this.db
      .insert(telemetryEventsTable)
      .values(serializeEvent(event))
      .onConflictDoUpdate({
        target: telemetryEventsTable.id,
        set: serializeEvent(event),
      });
  }

  async findRun(runId: string): Promise<TelemetryRun | null> {
    const rows = await this.db
      .select()
      .from(telemetryRunsTable)
      .where(eq(telemetryRunsTable.id, runId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : deserializeRun(row);
  }

  async findEvents(query: TelemetryEventQuery): Promise<TelemetryEvent[]> {
    const conditions = [];
    if (query.runId !== undefined) {
      conditions.push(eq(telemetryEventsTable.runId, query.runId));
    }
    if (query.types !== undefined && query.types.length > 0) {
      conditions.push(inArray(telemetryEventsTable.type, query.types));
    }
    if (query.from !== undefined && query.to !== undefined) {
      conditions.push(between(telemetryEventsTable.ts, query.from, query.to));
    }

    const rows =
      conditions.length > 0
        ? await this.db
            .select()
            .from(telemetryEventsTable)
            .where(and(...conditions))
        : await this.db.select().from(telemetryEventsTable);
    return rows.map(deserializeEvent);
  }
}

function serializeRun(run: TelemetryRun): typeof telemetryRunsTable.$inferInsert {
  return {
    id: run.id,
    mode: run.mode,
    venue: run.venue,
    capitalMode: run.capitalMode,
    market: run.market,
    configJson: JSON.stringify(run.configJson),
    gitSha: run.gitSha,
    gitDirty: run.gitDirty,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
  };
}

function deserializeRun(row: TelemetryRunRow): TelemetryRun {
  return {
    id: row.id,
    mode: row.mode as AppMode,
    venue: row.venue,
    capitalMode: row.capitalMode as CapitalMode,
    market: row.market,
    configJson: JSON.parse(row.configJson),
    gitSha: row.gitSha ?? undefined,
    gitDirty: row.gitDirty,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    status: row.status as TelemetryRun["status"],
  };
}

function serializeEvent(event: TelemetryEvent): typeof telemetryEventsTable.$inferInsert {
  return {
    id: event.id,
    runId: event.runId,
    mode: event.mode,
    venue: event.venue,
    type: event.type,
    ts: event.timestamp,
    market: event.market,
    payloadJson: JSON.stringify(event.payload),
  };
}

function deserializeEvent(row: TelemetryEventRow): TelemetryEvent {
  return {
    id: row.id,
    runId: row.runId,
    mode: row.mode as AppMode,
    venue: row.venue,
    type: row.type,
    timestamp: row.ts,
    market: row.market ?? undefined,
    payload: JSON.parse(row.payloadJson),
  } as TelemetryEvent;
}
