import { MarketDataBufferedWriter } from "../application/services/MarketDataBufferedWriter.ts";
import { createPostgresClient } from "../infrastructure/db/postgres/client.ts";
import { PostgresMarketDataRepository } from "../infrastructure/db/postgres/repository/PostgresMarketDataRepository.ts";
import { stringifyError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";
import { loadMarketDataRecorderConfig } from "./marketDataRecorderConfig.ts";
import { buildRecorderClient } from "./marketDataRecorderFactory.ts";
import { WorkerErrorNotifier } from "./WorkerErrorNotifier.ts";

const WORKER_NAME = "market-data-recorder";
const errorNotifier = new WorkerErrorNotifier(WORKER_NAME);

async function main(): Promise<void> {
  const config = await loadMarketDataRecorderConfig();
  const databaseUrl = requireEnv("DATABASE_URL");
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error("market-data-recorder requires PostgreSQL/TimescaleDB DATABASE_URL");
  }

  logger.info(
    `[worker] market-data-recorder | STARTUP | venue=${config.venue} symbol=${config.symbol} depth=${config.depth} database=postgres flushIntervalMs=${config.flushIntervalMs} maxBatchSize=${config.maxBatchSize}`,
  );

  const postgresClient = createPostgresClient(databaseUrl);
  const repository = new PostgresMarketDataRepository(postgresClient.db);
  const writer = new MarketDataBufferedWriter(repository, {
    flushIntervalMs: config.flushIntervalMs,
    maxBatchSize: config.maxBatchSize,
    onError: (error, context) => {
      errorNotifier.notifySoon(error, context);
    },
  });
  const recorder = buildRecorderClient(config);
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("[worker] market-data-recorder | SHUTDOWN_STARTED");
    try {
      await recorder.disconnect();
    } catch (error) {
      logger.error(
        `[worker] market-data-recorder | SHUTDOWN_DISCONNECT_FAILED | error=${stringifyError(error)}`,
      );
      await errorNotifier.notify(error, { event: "shutdown_disconnect_failed" });
    }
    try {
      const result = await writer.shutdown();
      logger.info(
        `[worker] market-data-recorder | SHUTDOWN_FLUSHED | insertedBookCount=${result.insertedBookCount} insertedTradeCount=${result.insertedTradeCount} insertedTickerCount=${result.insertedTickerCount} insertFailureCount=${result.insertFailureCount}`,
      );
    } catch (error) {
      logger.error(
        `[worker] market-data-recorder | SHUTDOWN_FLUSH_FAILED | error=${stringifyError(error)}`,
      );
      await errorNotifier.notify(error, { event: "shutdown_flush_failed" });
    }
    try {
      await postgresClient.client.end();
    } catch (error) {
      logger.error(
        `[worker] market-data-recorder | SHUTDOWN_DB_CLOSE_FAILED | error=${stringifyError(error)}`,
      );
      await errorNotifier.notify(error, { event: "shutdown_db_close_failed" });
    } finally {
      process.exit(0);
    }
  }

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  writer.start();
  await recorder.connect({
    onBookSnapshot: (row) => {
      void writer.addBookSnapshot(row).catch((error: unknown) => {
        logger.error(
          `[worker] market-data-recorder | BOOK_WRITE_FAILED | error=${stringifyError(error)}`,
        );
        errorNotifier.notifySoon(error, { event: "book_write_failed", kind: "book" });
      });
    },
    onTrade: (row) => {
      void writer.addTrade(row).catch((error: unknown) => {
        logger.error(
          `[worker] market-data-recorder | TRADE_WRITE_FAILED | error=${stringifyError(error)}`,
        );
        errorNotifier.notifySoon(error, { event: "trade_write_failed", kind: "trade" });
      });
    },
    onTicker: (row) => {
      void writer.addTicker(row).catch((error: unknown) => {
        logger.error(
          `[worker] market-data-recorder | TICKER_WRITE_FAILED | error=${stringifyError(error)}`,
        );
        errorNotifier.notifySoon(error, { event: "ticker_write_failed", kind: "ticker" });
      });
    },
    onError: (error) => {
      logger.error(`[worker] market-data-recorder | ERROR | error=${stringifyError(error)}`);
      errorNotifier.notifySoon(error, { event: "recorder_error" });
    },
  });
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isPostgresUrl(value: string): boolean {
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    await errorNotifier.notify(error, { event: "fatal" });
    logger.error(`[worker] market-data-recorder | FATAL | error=${stringifyError(error)}`);
    process.exit(1);
  }
}
