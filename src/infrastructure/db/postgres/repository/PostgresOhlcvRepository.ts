import { and, between, eq, sql } from "drizzle-orm";

import type { IOhlcvRepository, OhlcvRecord } from "../../../../domain/ports/IOhlcvRepository.ts";
import { ohlcvTable } from "../schema.ts";

type PostgresDb = ReturnType<typeof import("../client.ts").createPostgresClient>["db"];

export class PostgresOhlcvRepository implements IOhlcvRepository {
  constructor(private readonly db: PostgresDb) {}

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
    await this.db
      .insert(ohlcvTable)
      .values(records)
      .onConflictDoUpdate({
        target: [ohlcvTable.market, ohlcvTable.timeframe, ohlcvTable.ts],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
        },
      });
  }
}
