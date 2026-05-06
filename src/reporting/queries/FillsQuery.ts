import { and, asc, between, eq } from "drizzle-orm";

import type { Fill } from "../../domain/entities/Fill.ts";
import { fillsTable } from "../../infrastructure/db/sqlite/schema.ts";

type SqliteDb = ReturnType<
  typeof import("../../infrastructure/db/sqlite/client.ts").createSqliteClient
>["db"];

export interface FetchFillsInput {
  db: SqliteDb;
  venue?: string;
  periodStart: number;
  periodEnd: number;
}

export async function fetchFills({
  db,
  venue,
  periodStart,
  periodEnd,
}: FetchFillsInput): Promise<Fill[]> {
  const conditions = [between(fillsTable.filledAt, periodStart, periodEnd)];
  if (venue !== undefined) {
    conditions.push(eq(fillsTable.venue, venue));
  }
  const rows = await db
    .select()
    .from(fillsTable)
    .where(and(...conditions))
    .orderBy(asc(fillsTable.filledAt));
  return rows.map((row) => ({
    ...row,
    side: row.side as Fill["side"],
    quoteId: row.quoteId ?? undefined,
    markPriceAtFill: row.markPriceAtFill ?? undefined,
    markPrice5s: row.markPrice5s ?? undefined,
    markPrice30s: row.markPrice30s ?? undefined,
  }));
}
