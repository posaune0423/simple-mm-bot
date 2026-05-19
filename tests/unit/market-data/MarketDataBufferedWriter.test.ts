import { afterEach, describe, expect, test } from "bun:test";

import { MarketDataBufferedWriter } from "../../../src/application/services/MarketDataBufferedWriter.ts";
import type {
  MarketDataBookSnapshot,
  MarketDataTicker,
  MarketDataTrade,
} from "../../../src/domain/market-data/MarketDataRecord.ts";
import type { IMarketDataRepository } from "../../../src/domain/ports/IMarketDataRepository.ts";

class RecordingMarketDataRepository implements IMarketDataRepository {
  readonly bookBatches: MarketDataBookSnapshot[][] = [];
  readonly tradeBatches: MarketDataTrade[][] = [];
  readonly tickerBatches: MarketDataTicker[][] = [];
  failNextBookInsert = false;

  async insertBookSnapshots(rows: MarketDataBookSnapshot[]): Promise<void> {
    if (this.failNextBookInsert) {
      this.failNextBookInsert = false;
      throw new Error("transient insert failure");
    }
    this.bookBatches.push(rows);
  }

  async insertTrades(rows: MarketDataTrade[]): Promise<void> {
    this.tradeBatches.push(rows);
  }

  async insertTickers(rows: MarketDataTicker[]): Promise<void> {
    this.tickerBatches.push(rows);
  }
}

function book(id: string): MarketDataBookSnapshot {
  return {
    id,
    venue: "bulk",
    symbol: "BTC-USD",
    receivedAt: 1_700_000_000_000,
    depth: 1,
    bestBidPrice: 99,
    bestBidSize: 2,
    bestAskPrice: 101,
    bestAskSize: 1,
    midPrice: 100,
    spreadBps: 200,
    bids: [{ price: 99, quantity: 2 }],
    asks: [{ price: 101, quantity: 1 }],
  };
}

function trade(id: string): MarketDataTrade {
  return {
    id,
    venue: "bulk",
    symbol: "BTC-USD",
    receivedAt: 1_700_000_000_000,
    price: 100,
    quantity: 1,
  };
}

function ticker(id: string): MarketDataTicker {
  return {
    id,
    venue: "bulk",
    symbol: "BTC-USD",
    receivedAt: 1_700_000_000_000,
    markPrice: 100,
  };
}

describe("MarketDataBufferedWriter", () => {
  let writers: MarketDataBufferedWriter[] = [];

  afterEach(async () => {
    await Promise.all(writers.map(async (writer) => writer.shutdown()));
    writers = [];
  });

  test("empty flush is a no-op", async () => {
    const repository = new RecordingMarketDataRepository();
    const writer = new MarketDataBufferedWriter(repository, {
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
    });
    writers.push(writer);

    const result = await writer.flush();

    expect(result).toEqual({
      insertedBookCount: 0,
      insertedTradeCount: 0,
      insertedTickerCount: 0,
      insertFailureCount: 0,
    });
    expect(repository.bookBatches).toEqual([]);
    expect(repository.tradeBatches).toEqual([]);
    expect(repository.tickerBatches).toEqual([]);
  });

  test("maxBatchSize triggers flush for each record type", async () => {
    const repository = new RecordingMarketDataRepository();
    const writer = new MarketDataBufferedWriter(repository, {
      flushIntervalMs: 60_000,
      maxBatchSize: 2,
    });
    writers.push(writer);

    await writer.addBookSnapshot(book("book-1"));
    await writer.addBookSnapshot(book("book-2"));
    await writer.addTrade(trade("trade-1"));
    await writer.addTrade(trade("trade-2"));
    await writer.addTicker(ticker("ticker-1"));
    await writer.addTicker(ticker("ticker-2"));

    expect(repository.bookBatches).toEqual([[book("book-1"), book("book-2")]]);
    expect(repository.tradeBatches).toEqual([[trade("trade-1"), trade("trade-2")]]);
    expect(repository.tickerBatches).toEqual([[ticker("ticker-1"), ticker("ticker-2")]]);
  });

  test("timer triggers flush", async () => {
    const repository = new RecordingMarketDataRepository();
    const writer = new MarketDataBufferedWriter(repository, {
      flushIntervalMs: 5,
      maxBatchSize: 100,
    });
    writers.push(writer);

    writer.start();
    await writer.addBookSnapshot(book("book-1"));
    await waitFor(() => repository.bookBatches.length === 1);

    expect(repository.bookBatches).toEqual([[book("book-1")]]);
  });

  test("shutdown flushes remaining rows", async () => {
    const repository = new RecordingMarketDataRepository();
    const writer = new MarketDataBufferedWriter(repository, {
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
    });

    await writer.addBookSnapshot(book("book-1"));
    await writer.addTrade(trade("trade-1"));
    await writer.addTicker(ticker("ticker-1"));

    const result = await writer.shutdown();

    expect(result).toEqual({
      insertedBookCount: 1,
      insertedTradeCount: 1,
      insertedTickerCount: 1,
      insertFailureCount: 0,
    });
    expect(repository.bookBatches).toEqual([[book("book-1")]]);
    expect(repository.tradeBatches).toEqual([[trade("trade-1")]]);
    expect(repository.tickerBatches).toEqual([[ticker("ticker-1")]]);
  });

  test("preserves failed batches for the next flush", async () => {
    const repository = new RecordingMarketDataRepository();
    repository.failNextBookInsert = true;
    const writer = new MarketDataBufferedWriter(repository, {
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
    });
    writers.push(writer);

    await writer.addBookSnapshot(book("book-retry-1"));

    const failed = await writer.flush();
    const retried = await writer.flush();

    expect(failed).toEqual({
      insertedBookCount: 0,
      insertedTradeCount: 0,
      insertedTickerCount: 0,
      insertFailureCount: 1,
    });
    expect(retried).toEqual({
      insertedBookCount: 1,
      insertedTradeCount: 0,
      insertedTickerCount: 0,
      insertFailureCount: 0,
    });
    expect(repository.bookBatches).toEqual([[book("book-retry-1")]]);
  });

  test("calls onError when a batch insert fails", async () => {
    const repository = new RecordingMarketDataRepository();
    repository.failNextBookInsert = true;
    const errors: Array<{ error: unknown; event: string; kind: string; rows: number }> = [];
    const writer = new MarketDataBufferedWriter(repository, {
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
      onError: (error, context) => {
        errors.push({ error, ...context });
      },
    });
    writers.push(writer);

    await writer.addBookSnapshot(book("book-error-1"));
    await writer.flush();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(errors[0]).toMatchObject({
      event: "insert_failed",
      kind: "book",
      rows: 1,
    });
  });

  test("does not reject flush when onError throws synchronously", async () => {
    const repository = new RecordingMarketDataRepository();
    repository.failNextBookInsert = true;
    const writer = new MarketDataBufferedWriter(repository, {
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
      onError: () => {
        throw new Error("notification failed");
      },
    });
    writers.push(writer);

    await writer.addBookSnapshot(book("book-error-2"));
    const result = await writer.flush();

    expect(result.insertFailureCount).toBe(1);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(5);
  }
  expect(predicate()).toBe(true);
}
