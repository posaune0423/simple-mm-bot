import { describe, expect, test } from "bun:test";

import { ExternalMarketBufferedWriter } from "../../../src/application/services/ExternalMarketBufferedWriter.ts";
import type { ExternalMarketTopOfBookRecord } from "../../../src/domain/external-market/ExternalMarketTypes.ts";
import type { IExternalMarketRepository } from "../../../src/domain/ports/IExternalMarketRepository.ts";

describe("ExternalMarketBufferedWriter", () => {
  test("flushes when maxBatchSize is reached", async () => {
    const repository = new FakeExternalMarketRepository();
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 2,
    });

    await writer.addTopOfBook(topOfBook("one"));
    await writer.addTopOfBook(topOfBook("two"));

    expect(repository.topOfBookBatches).toEqual([["one", "two"]]);
    expect(writer.snapshotCounters().insertedTopOfBookCount).toBe(2);
  });

  test("shutdown flushes remaining top-of-book rows", async () => {
    const repository = new FakeExternalMarketRepository();
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
    });

    await writer.addTopOfBook(topOfBook("one"));
    const result = await writer.shutdown();

    expect(result.insertedTopOfBookCount).toBe(1);
    expect(repository.topOfBookBatches).toEqual([["one"]]);
  });

  test("empty flush is a no-op", async () => {
    const repository = new FakeExternalMarketRepository();
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
    });

    const result = await writer.flush();

    expect(result.insertedTopOfBookCount).toBe(0);
    expect(repository.topOfBookBatches).toHaveLength(0);
  });

  test("records insert failure and keeps rows for a later flush", async () => {
    const repository = new FakeExternalMarketRepository({ failTopOfBookOnce: true });
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
    });

    await writer.addTopOfBook(topOfBook("one"));
    const failed = await writer.flush();
    const retried = await writer.flush();

    expect(failed.insertFailureCount).toBe(1);
    expect(retried.insertedTopOfBookCount).toBe(1);
    expect(repository.topOfBookBatches).toEqual([["one"]]);
  });

  test("calls onError when an insert fails", async () => {
    const repository = new FakeExternalMarketRepository({ failTopOfBookOnce: true });
    const errors: Array<{ error: unknown; event: string; kind: string; rows: number }> = [];
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
      onError: (error, context) => {
        errors.push({ error, ...context });
      },
    });

    await writer.addTopOfBook(topOfBook("one"));
    await writer.flush();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(errors[0]).toMatchObject({
      event: "insert_failed",
      kind: "top_of_book",
      rows: 1,
    });
  });

  test("does not reject flush when onError throws synchronously", async () => {
    const repository = new FakeExternalMarketRepository({ failTopOfBookOnce: true });
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
      onError: () => {
        throw new Error("notification failed");
      },
    });

    await writer.addTopOfBook(topOfBook("one"));
    const result = await writer.flush();

    expect(result.insertFailureCount).toBe(1);
  });

  test("stores only the latest top-of-book row per source in each sampling window", async () => {
    const repository = new FakeExternalMarketRepository();
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
      topOfBook: {
        mode: "sampled_latest",
        sampleIntervalMs: 250,
        storeRawJson: false,
      },
    });

    await writer.addTopOfBook(topOfBook("binance-0", { receivedAt: 1_000, raw: { first: true } }));
    await writer.addTopOfBook(topOfBook("binance-1", { receivedAt: 1_100, raw: { second: true } }));
    await writer.addTopOfBook(
      topOfBook("okx-0", { venue: "okx_swap", symbol: "BTC-USDT-SWAP", receivedAt: 1_120 }),
    );
    await writer.addTopOfBook(topOfBook("binance-2", { receivedAt: 1_260, raw: { third: true } }));
    await writer.shutdown();

    expect(repository.topOfBookBatches).toEqual([["binance-1", "binance-2", "okx-0"]]);
    expect(repository.topOfBookRows.map((row) => row.raw)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(writer.snapshotCounters().receivedTopOfBookCount).toBe(4);
    expect(writer.snapshotCounters().insertedTopOfBookCount).toBe(3);
  });

  test("shutdown flushes sampled rows after an in-flight flush completes", async () => {
    const insertGate = createGate();
    const repository = new FakeExternalMarketRepository({ topOfBookInsertGate: insertGate });
    const writer = new ExternalMarketBufferedWriter(repository, {
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
      topOfBook: {
        mode: "sampled_latest",
        sampleIntervalMs: 250,
        storeRawJson: false,
      },
    });

    const futureBaseMs = Date.now() + 1_000_000;
    await writer.addTopOfBook(topOfBook("first-window-latest", { receivedAt: futureBaseMs }));
    await writer.addTopOfBook(
      topOfBook("second-window-latest", { receivedAt: futureBaseMs + 260 }),
    );

    const inFlightFlush = writer.flush();
    await insertGate.started;
    const shutdown = writer.shutdown();
    insertGate.release();
    await inFlightFlush;
    await shutdown;

    expect(repository.topOfBookBatches).toEqual([
      ["first-window-latest"],
      ["second-window-latest"],
    ]);
  });
});

class FakeExternalMarketRepository implements IExternalMarketRepository {
  readonly topOfBookBatches: string[][] = [];
  readonly topOfBookRows: ExternalMarketTopOfBookRecord[] = [];
  private shouldFailTopOfBookOnce: boolean;
  private readonly topOfBookInsertGate: InsertGate | undefined;

  constructor(options: { failTopOfBookOnce?: boolean; topOfBookInsertGate?: InsertGate } = {}) {
    this.shouldFailTopOfBookOnce = options.failTopOfBookOnce === true;
    this.topOfBookInsertGate = options.topOfBookInsertGate;
  }

  async insertTopOfBook(rows: ExternalMarketTopOfBookRecord[]): Promise<void> {
    await this.topOfBookInsertGate?.wait();
    if (this.shouldFailTopOfBookOnce) {
      this.shouldFailTopOfBookOnce = false;
      throw new Error("insert failed");
    }
    if (rows.length > 0) {
      this.topOfBookRows.push(...rows);
      this.topOfBookBatches.push(rows.map((row) => row.id));
    }
  }

  async insertTickers(): Promise<void> {}

  async insertTrades(): Promise<void> {}
}

type InsertGate = ReturnType<typeof createGate>;

function createGate() {
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started: startedPromise,
    release,
    async wait(): Promise<void> {
      started();
      await releasePromise;
    },
  };
}

function topOfBook(
  id: string,
  overrides: Partial<ExternalMarketTopOfBookRecord> = {},
): ExternalMarketTopOfBookRecord {
  return {
    id,
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    receivedAt: 1_700_000_000_001,
    bidPrice: 99,
    bidSize: 1,
    askPrice: 101,
    askSize: 1,
    midPrice: 100,
    microPrice: 100,
    spreadBps: 200,
    ...overrides,
  };
}
