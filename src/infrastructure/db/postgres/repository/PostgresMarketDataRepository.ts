import type {
  MarketDataBookSnapshot,
  MarketDataTicker,
  MarketDataTrade,
} from "../../../../domain/market-data/MarketDataRecord.ts";
import type { IMarketDataRepository } from "../../../../domain/ports/IMarketDataRepository.ts";
import {
  marketDataOrderBookSnapshotsTable,
  marketDataTickersTable,
  marketDataTradesTable,
} from "../schema.ts";

type PostgresDb = ReturnType<typeof import("../client.ts").createPostgresClient>["db"];

export class PostgresMarketDataRepository implements IMarketDataRepository {
  constructor(private readonly db: PostgresDb) {}

  async insertBookSnapshots(rows: MarketDataBookSnapshot[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insert(marketDataOrderBookSnapshotsTable)
      .values(rows.map(toDbBookSnapshot))
      .onConflictDoNothing();
  }

  async insertTrades(rows: MarketDataTrade[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db.insert(marketDataTradesTable).values(rows.map(toDbTrade)).onConflictDoNothing();
  }

  async insertTickers(rows: MarketDataTicker[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db.insert(marketDataTickersTable).values(rows.map(toDbTicker)).onConflictDoNothing();
  }
}

function toDbBookSnapshot(
  row: MarketDataBookSnapshot,
): typeof marketDataOrderBookSnapshotsTable.$inferInsert {
  return {
    id: row.id,
    venue: row.venue,
    symbol: row.symbol,
    exchangeTime: row.exchangeTime,
    receivedAt: row.receivedAt,
    depth: row.depth,
    bestBidPrice: row.bestBidPrice,
    bestBidSize: row.bestBidSize,
    bestAskPrice: row.bestAskPrice,
    bestAskSize: row.bestAskSize,
    midPrice: row.midPrice,
    microPrice: row.microPrice,
    vampPrice: row.vampPrice,
    spreadBps: row.spreadBps,
    bidsJson: JSON.stringify(row.bids),
    asksJson: JSON.stringify(row.asks),
    sequence: row.sequence,
    rawJson: stringifyOptional(row.raw),
  };
}

function toDbTrade(row: MarketDataTrade): typeof marketDataTradesTable.$inferInsert {
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

function toDbTicker(row: MarketDataTicker): typeof marketDataTickersTable.$inferInsert {
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

function stringifyOptional(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}
