import { and, between, eq } from "drizzle-orm";

import type { IOhlcvRepository, OhlcvRecord } from "../../../../domain/ports/IOhlcvRepository.ts";
import { ohlcvTable } from "../schema.ts";

type SqliteDb = ReturnType<typeof import("../client.ts").createSqliteClient>["db"];

export class SqliteOhlcvRepository implements IOhlcvRepository {
  constructor(private readonly db: SqliteDb) {}

  async findByRange(
    market: string,
    timeframe: string,
    from: number,
    to: number,
  ): Promise<OhlcvRecord[]> {
    return this.db
      .select()
      .from(ohlcvTable)
      .where(
        and(
          eq(ohlcvTable.market, market),
          eq(ohlcvTable.timeframe, timeframe),
          between(ohlcvTable.ts, from, to),
        ),
      );
  }

  async saveMany(records: OhlcvRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.db.insert(ohlcvTable).values(records).onConflictDoNothing();
  }
}
