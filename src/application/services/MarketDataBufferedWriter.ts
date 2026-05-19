import type {
  MarketDataBookSnapshot,
  MarketDataTicker,
  MarketDataTrade,
} from "../../domain/market-data/MarketDataRecord.ts";
import type { IMarketDataRepository } from "../../domain/ports/IMarketDataRepository.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

export type MarketDataBufferedWriterConfig = {
  flushIntervalMs: number;
  maxBatchSize: number;
  onError?: (error: unknown, context: MarketDataBufferedWriterErrorContext) => void | Promise<void>;
};

export type MarketDataFlushResult = {
  insertedBookCount: number;
  insertedTradeCount: number;
  insertedTickerCount: number;
  insertFailureCount: number;
};

export type MarketDataBufferedWriterErrorContext = {
  event: "flush_failed" | "insert_failed";
  kind: "book" | "trade" | "ticker" | "flush";
  rows: number;
};

type MarketDataCounters = {
  receivedBookCount: number;
  receivedTradeCount: number;
  receivedTickerCount: number;
  insertedBookCount: number;
  insertedTradeCount: number;
  insertedTickerCount: number;
  insertFailureCount: number;
};

export class MarketDataBufferedWriter {
  private readonly books: MarketDataBookSnapshot[] = [];
  private readonly trades: MarketDataTrade[] = [];
  private readonly tickers: MarketDataTicker[] = [];
  private readonly counters: MarketDataCounters = {
    receivedBookCount: 0,
    receivedTradeCount: 0,
    receivedTickerCount: 0,
    insertedBookCount: 0,
    insertedTradeCount: 0,
    insertedTickerCount: 0,
    insertFailureCount: 0,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<MarketDataFlushResult> | null = null;

  constructor(
    private readonly repository: IMarketDataRepository,
    private readonly config: MarketDataBufferedWriterConfig,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush()
        .then((result) => {
          logger.info(
            `[worker] market-data-recorder | FLUSH | receivedBookCount=${this.counters.receivedBookCount} receivedTradeCount=${this.counters.receivedTradeCount} receivedTickerCount=${this.counters.receivedTickerCount} insertedBookCount=${this.counters.insertedBookCount} insertedTradeCount=${this.counters.insertedTradeCount} insertedTickerCount=${this.counters.insertedTickerCount} insertFailureCount=${this.counters.insertFailureCount} lastInsertedBookCount=${result.insertedBookCount} lastInsertedTradeCount=${result.insertedTradeCount} lastInsertedTickerCount=${result.insertedTickerCount}`,
          );
        })
        .catch((error: unknown) => {
          logger.error(
            `[worker] market-data-recorder | FLUSH_FAILED | error=${stringifyError(error)}`,
          );
          this.notifyError(error, { event: "flush_failed", kind: "flush", rows: 0 });
        });
    }, this.config.flushIntervalMs);
  }

  async addBookSnapshot(row: MarketDataBookSnapshot): Promise<void> {
    this.books.push(row);
    this.counters.receivedBookCount += 1;
    if (this.books.length >= this.config.maxBatchSize) {
      await this.flush();
    }
  }

  async addTrade(row: MarketDataTrade): Promise<void> {
    this.trades.push(row);
    this.counters.receivedTradeCount += 1;
    if (this.trades.length >= this.config.maxBatchSize) {
      await this.flush();
    }
  }

  async addTicker(row: MarketDataTicker): Promise<void> {
    this.tickers.push(row);
    this.counters.receivedTickerCount += 1;
    if (this.tickers.length >= this.config.maxBatchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<MarketDataFlushResult> {
    if (this.flushInFlight !== null) {
      return this.flushInFlight;
    }
    this.flushInFlight = this.flushOnce().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  async shutdown(): Promise<MarketDataFlushResult> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return await this.flush();
  }

  snapshotCounters(): MarketDataCounters {
    return { ...this.counters };
  }

  private async flushOnce(): Promise<MarketDataFlushResult> {
    const books = this.books.slice();
    const trades = this.trades.slice();
    const tickers = this.tickers.slice();
    const result: MarketDataFlushResult = {
      insertedBookCount: 0,
      insertedTradeCount: 0,
      insertedTickerCount: 0,
      insertFailureCount: 0,
    };

    const booksInserted = await this.insertBatch(
      "book",
      books,
      async () => this.repository.insertBookSnapshots(books),
      result,
    );
    if (booksInserted) {
      this.books.splice(0, books.length);
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

    const tickersInserted = await this.insertBatch(
      "ticker",
      tickers,
      async () => this.repository.insertTickers(tickers),
      result,
    );
    if (tickersInserted) {
      this.tickers.splice(0, tickers.length);
    }

    this.counters.insertedBookCount += result.insertedBookCount;
    this.counters.insertedTradeCount += result.insertedTradeCount;
    this.counters.insertedTickerCount += result.insertedTickerCount;
    this.counters.insertFailureCount += result.insertFailureCount;
    return result;
  }

  private async insertBatch(
    kind: "book" | "trade" | "ticker",
    rows: unknown[],
    insert: () => Promise<void>,
    result: MarketDataFlushResult,
  ): Promise<boolean> {
    if (rows.length === 0) {
      return true;
    }
    try {
      await insert();
      if (kind === "book") {
        result.insertedBookCount = rows.length;
      } else if (kind === "trade") {
        result.insertedTradeCount = rows.length;
      } else {
        result.insertedTickerCount = rows.length;
      }
      return true;
    } catch (error) {
      result.insertFailureCount += 1;
      logger.error(
        `[worker] market-data-recorder | INSERT_FAILED | kind=${kind} rows=${rows.length} error=${stringifyError(error)}`,
      );
      this.notifyError(error, { event: "insert_failed", kind, rows: rows.length });
      return false;
    }
  }

  private notifyError(error: unknown, context: MarketDataBufferedWriterErrorContext): void {
    const onError = this.config.onError;
    if (onError === undefined) {
      return;
    }
    void Promise.resolve(onError(error, context)).catch((notifyError: unknown) => {
      logger.warn(
        `[worker] market-data-recorder | ERROR_HANDLER_FAILED | error=${stringifyError(notifyError)}`,
      );
    });
  }
}
