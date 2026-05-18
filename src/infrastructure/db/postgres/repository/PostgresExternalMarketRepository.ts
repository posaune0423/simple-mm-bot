import type {
  ExternalMarketTickerRecord,
  ExternalMarketTopOfBookRecord,
  ExternalMarketTradeRecord,
} from "../../../../domain/external-market/ExternalMarketTypes.ts";
import type { IExternalMarketRepository } from "../../../../domain/ports/IExternalMarketRepository.ts";
import {
  externalMarketTickersTable,
  externalMarketTopOfBookTable,
  externalMarketTradesTable,
} from "../schema.ts";

type PostgresDb = ReturnType<typeof import("../client.ts").createPostgresClient>["db"];

export class PostgresExternalMarketRepository implements IExternalMarketRepository {
  constructor(private readonly db: PostgresDb) {}

  async insertTopOfBook(rows: ExternalMarketTopOfBookRecord[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insert(externalMarketTopOfBookTable)
      .values(rows.map(toDbTopOfBook))
      .onConflictDoNothing();
  }

  async insertTickers(rows: ExternalMarketTickerRecord[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insert(externalMarketTickersTable)
      .values(rows.map(toDbTicker))
      .onConflictDoNothing();
  }

  async insertTrades(rows: ExternalMarketTradeRecord[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insert(externalMarketTradesTable)
      .values(rows.map(toDbTrade))
      .onConflictDoNothing();
  }
}

function toDbTopOfBook(
  row: ExternalMarketTopOfBookRecord,
): typeof externalMarketTopOfBookTable.$inferInsert {
  return {
    id: row.id,
    venue: row.venue,
    symbol: row.symbol,
    exchangeTime: row.exchangeTime,
    receivedAt: row.receivedAt,
    bidPrice: row.bidPrice,
    bidSize: row.bidSize,
    askPrice: row.askPrice,
    askSize: row.askSize,
    midPrice: row.midPrice,
    microPrice: row.microPrice,
    spreadBps: row.spreadBps,
    sequence: row.sequence,
    rawJson: stringifyOptional(row.raw),
  };
}

function toDbTicker(
  row: ExternalMarketTickerRecord,
): typeof externalMarketTickersTable.$inferInsert {
  return {
    id: row.id,
    venue: row.venue,
    symbol: row.symbol,
    exchangeTime: row.exchangeTime,
    receivedAt: row.receivedAt,
    markPrice: row.markPrice,
    indexPrice: row.indexPrice,
    lastPrice: row.lastPrice,
    fundingRate: row.fundingRate,
    openInterest: row.openInterest,
    rawJson: stringifyOptional(row.raw),
  };
}

function toDbTrade(row: ExternalMarketTradeRecord): typeof externalMarketTradesTable.$inferInsert {
  return {
    id: row.id,
    venue: row.venue,
    symbol: row.symbol,
    tradeId: row.tradeId,
    exchangeTime: row.exchangeTime,
    receivedAt: row.receivedAt,
    price: row.price,
    quantity: row.quantity,
    side: row.side,
    aggressorSide: row.aggressorSide,
    rawJson: stringifyOptional(row.raw),
  };
}

function stringifyOptional(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}
