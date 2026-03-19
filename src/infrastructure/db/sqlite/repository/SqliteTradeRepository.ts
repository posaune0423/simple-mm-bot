import { and, between } from "drizzle-orm";

import type { Fill } from "../../../../domain/entities/Fill.ts";
import type { ITradeRepository } from "../../../../domain/ports/ITradeRepository.ts";
import { fillsTable } from "../schema.ts";

type SqliteDb = ReturnType<typeof import("../client.ts").createSqliteClient>["db"];

export class SqliteTradeRepository implements ITradeRepository {
  constructor(private readonly db: SqliteDb) {}

  async save(fill: Fill): Promise<void> {
    await this.db.insert(fillsTable).values(fill).onConflictDoUpdate({
      target: fillsTable.id,
      set: fill,
    });
  }

  async findByRange(from: number, to: number): Promise<Fill[]> {
    const rows = await this.db
      .select()
      .from(fillsTable)
      .where(and(between(fillsTable.filledAt, from, to)));
    return rows.map(normalizeFillRow);
  }

  async findAll(): Promise<Fill[]> {
    const rows = await this.db.select().from(fillsTable);
    return rows.map(normalizeFillRow);
  }
}

function normalizeFillRow(row: typeof fillsTable.$inferSelect): Fill {
  return {
    ...row,
    side: row.side as Fill["side"],
    quoteId: row.quoteId ?? undefined,
    markPriceAtFill: row.markPriceAtFill ?? undefined,
    markPrice5s: row.markPrice5s ?? undefined,
    markPrice30s: row.markPrice30s ?? undefined,
  };
}
