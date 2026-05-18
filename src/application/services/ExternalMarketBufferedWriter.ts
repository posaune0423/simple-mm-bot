import type {
  ExternalMarketTickerRecord,
  ExternalMarketTopOfBookRecord,
  ExternalMarketTradeRecord,
} from "../../domain/external-market/ExternalMarketTypes.ts";
import type { IExternalMarketRepository } from "../../domain/ports/IExternalMarketRepository.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

export type ExternalMarketTopOfBookWriterConfig = {
  mode: "all" | "sampled_latest";
  sampleIntervalMs: number;
  storeRawJson: boolean;
};

export type ExternalMarketBufferedWriterConfig = {
  flushIntervalMs: number;
  maxBatchSize: number;
  topOfBook?: ExternalMarketTopOfBookWriterConfig;
};

export type ExternalMarketFlushResult = {
  insertedTopOfBookCount: number;
  insertedTickerCount: number;
  insertedTradeCount: number;
  insertFailureCount: number;
};

type ExternalMarketCounters = {
  receivedTopOfBookCount: number;
  receivedTickerCount: number;
  receivedTradeCount: number;
  insertedTopOfBookCount: number;
  insertedTickerCount: number;
  insertedTradeCount: number;
  insertFailureCount: number;
};

type SampledTopOfBookState = {
  windowStartAt: number;
  latest: ExternalMarketTopOfBookRecord;
};

export class ExternalMarketBufferedWriter {
  private readonly topOfBooks: ExternalMarketTopOfBookRecord[] = [];
  private readonly tickers: ExternalMarketTickerRecord[] = [];
  private readonly trades: ExternalMarketTradeRecord[] = [];
  private readonly sampledTopOfBooks = new Map<string, SampledTopOfBookState>();
  private readonly counters: ExternalMarketCounters = {
    receivedTopOfBookCount: 0,
    receivedTickerCount: 0,
    receivedTradeCount: 0,
    insertedTopOfBookCount: 0,
    insertedTickerCount: 0,
    insertedTradeCount: 0,
    insertFailureCount: 0,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<ExternalMarketFlushResult> | null = null;

  constructor(
    private readonly repository: IExternalMarketRepository,
    private readonly config: ExternalMarketBufferedWriterConfig,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush().then((result) => {
        logger.info(
          `[worker] external-market-recorder | FLUSH | receivedTopOfBookCount=${this.counters.receivedTopOfBookCount} receivedTickerCount=${this.counters.receivedTickerCount} receivedTradeCount=${this.counters.receivedTradeCount} insertedTopOfBookCount=${this.counters.insertedTopOfBookCount} insertedTickerCount=${this.counters.insertedTickerCount} insertedTradeCount=${this.counters.insertedTradeCount} insertFailureCount=${this.counters.insertFailureCount} lastInsertedTopOfBookCount=${result.insertedTopOfBookCount} lastInsertedTickerCount=${result.insertedTickerCount} lastInsertedTradeCount=${result.insertedTradeCount}`,
        );
      });
    }, this.config.flushIntervalMs);
  }

  async addTopOfBook(row: ExternalMarketTopOfBookRecord): Promise<void> {
    this.counters.receivedTopOfBookCount += 1;
    const rowForStorage = this.prepareTopOfBook(row);
    if (this.topOfBookConfig().mode === "sampled_latest") {
      this.addSampledTopOfBook(rowForStorage);
    } else {
      this.topOfBooks.push(rowForStorage);
    }
    if (this.topOfBooks.length >= this.config.maxBatchSize) {
      await this.flush();
    }
  }

  async addTicker(row: ExternalMarketTickerRecord): Promise<void> {
    this.tickers.push(row);
    this.counters.receivedTickerCount += 1;
    if (this.tickers.length >= this.config.maxBatchSize) {
      await this.flush();
    }
  }

  async addTrade(row: ExternalMarketTradeRecord): Promise<void> {
    this.trades.push(row);
    this.counters.receivedTradeCount += 1;
    if (this.trades.length >= this.config.maxBatchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<ExternalMarketFlushResult> {
    if (this.flushInFlight !== null) {
      return this.flushInFlight;
    }
    this.flushInFlight = this.flushOnce().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  async shutdown(): Promise<ExternalMarketFlushResult> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.flushInFlight !== null) {
      await this.flushInFlight;
    }
    this.promoteSampledTopOfBooks(Date.now(), true);
    return await this.flush();
  }

  snapshotCounters(): ExternalMarketCounters {
    return { ...this.counters };
  }

  private async flushOnce(): Promise<ExternalMarketFlushResult> {
    this.promoteSampledTopOfBooks(Date.now(), false);
    const topOfBooks = this.topOfBooks.slice();
    const tickers = this.tickers.slice();
    const trades = this.trades.slice();
    const result: ExternalMarketFlushResult = {
      insertedTopOfBookCount: 0,
      insertedTickerCount: 0,
      insertedTradeCount: 0,
      insertFailureCount: 0,
    };

    const topOfBooksInserted = await this.insertBatch(
      "top_of_book",
      topOfBooks,
      async () => this.repository.insertTopOfBook(topOfBooks),
      result,
    );
    if (topOfBooksInserted) {
      this.topOfBooks.splice(0, topOfBooks.length);
    }

    const tickersInserted = await this.insertBatch(
      "ticker",
      tickers,
      async () => this.repository.insertTickers(tickers),
      result,
    );
    if (tickersInserted) {
      this.tickers.splice(0, tickers.length);
    }

    const tradesInserted = await this.insertBatch(
      "trade",
      trades,
      async () => this.repository.insertTrades(trades),
      result,
    );
    if (tradesInserted) {
      this.trades.splice(0, trades.length);
    }

    this.counters.insertedTopOfBookCount += result.insertedTopOfBookCount;
    this.counters.insertedTickerCount += result.insertedTickerCount;
    this.counters.insertedTradeCount += result.insertedTradeCount;
    this.counters.insertFailureCount += result.insertFailureCount;
    return result;
  }

  private async insertBatch(
    kind: "top_of_book" | "ticker" | "trade",
    rows: unknown[],
    insert: () => Promise<void>,
    result: ExternalMarketFlushResult,
  ): Promise<boolean> {
    if (rows.length === 0) {
      return true;
    }
    try {
      await insert();
      if (kind === "top_of_book") {
        result.insertedTopOfBookCount = rows.length;
      } else if (kind === "ticker") {
        result.insertedTickerCount = rows.length;
      } else {
        result.insertedTradeCount = rows.length;
      }
      return true;
    } catch (error) {
      result.insertFailureCount += 1;
      logger.error(
        `[worker] external-market-recorder | INSERT_FAILED | kind=${kind} rows=${rows.length} error=${stringifyError(error)}`,
      );
      return false;
    }
  }

  private addSampledTopOfBook(row: ExternalMarketTopOfBookRecord): void {
    const config = this.topOfBookConfig();
    const key = `${row.venue}:${row.symbol}`;
    const state = this.sampledTopOfBooks.get(key);
    if (state === undefined) {
      this.sampledTopOfBooks.set(key, {
        windowStartAt: row.receivedAt,
        latest: row,
      });
      return;
    }

    if (row.receivedAt - state.windowStartAt >= config.sampleIntervalMs) {
      this.topOfBooks.push(state.latest);
      this.sampledTopOfBooks.set(key, {
        windowStartAt: row.receivedAt,
        latest: row,
      });
      return;
    }

    this.sampledTopOfBooks.set(key, {
      ...state,
      latest: row,
    });
  }

  private promoteSampledTopOfBooks(nowMs: number, force: boolean): void {
    const config = this.topOfBookConfig();
    if (config.mode !== "sampled_latest") {
      return;
    }
    for (const [key, state] of this.sampledTopOfBooks) {
      if (force || nowMs - state.windowStartAt >= config.sampleIntervalMs) {
        this.topOfBooks.push(state.latest);
        this.sampledTopOfBooks.delete(key);
      }
    }
  }

  private prepareTopOfBook(row: ExternalMarketTopOfBookRecord): ExternalMarketTopOfBookRecord {
    if (this.topOfBookConfig().storeRawJson) {
      return row;
    }
    const { raw: _raw, ...rowWithoutRaw } = row;
    return rowWithoutRaw;
  }

  private topOfBookConfig(): ExternalMarketTopOfBookWriterConfig {
    return (
      this.config.topOfBook ?? {
        mode: "all",
        sampleIntervalMs: 1,
        storeRawJson: true,
      }
    );
  }
}
