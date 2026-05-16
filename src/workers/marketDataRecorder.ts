import { match } from "ts-pattern";

import { MarketDataBufferedWriter } from "../application/services/MarketDataBufferedWriter.ts";
import type { RecorderVenue } from "../domain/market-data/MarketDataRecord.ts";
import { createPostgresClient } from "../infrastructure/db/postgres/client.ts";
import { PostgresMarketDataRepository } from "../infrastructure/db/postgres/repository/PostgresMarketDataRepository.ts";
import { stringifyError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";
import { buildRecorderClient } from "./marketDataRecorderFactory.ts";

const recorderVenues = [
  "bulk",
  "binance_usdm",
  "okx_swap",
  "bybit_linear",
] as const satisfies readonly RecorderVenue[];

async function main(): Promise<void> {
  const venue = parseRecorderVenue(Bun.env.RECORDER_VENUE ?? "bulk");
  const symbol = Bun.env.RECORDER_SYMBOL ?? "BTC-USD";
  const depth = parsePositiveInteger(Bun.env.RECORDER_DEPTH ?? "10", "RECORDER_DEPTH");
  const flushIntervalMs = parsePositiveInteger(
    Bun.env.RECORDER_FLUSH_INTERVAL_MS ?? "250",
    "RECORDER_FLUSH_INTERVAL_MS",
  );
  const maxBatchSize = parsePositiveInteger(
    Bun.env.RECORDER_MAX_BATCH_SIZE ?? "1000",
    "RECORDER_MAX_BATCH_SIZE",
  );
  const databaseUrl = requireEnv("DATABASE_URL");
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error("market-data-recorder requires PostgreSQL/TimescaleDB DATABASE_URL");
  }

  logger.info(
    `[worker] market-data-recorder | STARTUP | venue=${venue} symbol=${symbol} depth=${depth} database=postgres flushIntervalMs=${flushIntervalMs} maxBatchSize=${maxBatchSize}`,
  );

  const postgresClient = createPostgresClient(databaseUrl);
  const repository = new PostgresMarketDataRepository(postgresClient.db);
  const writer = new MarketDataBufferedWriter(repository, {
    flushIntervalMs,
    maxBatchSize,
  });
  const recorder = buildRecorderClient({ venue, symbol, depth });
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("[worker] market-data-recorder | SHUTDOWN_STARTED");
    await recorder.disconnect();
    const result = await writer.shutdown();
    await postgresClient.client.end();
    logger.info(
      `[worker] market-data-recorder | SHUTDOWN_FLUSHED | insertedBookCount=${result.insertedBookCount} insertedTradeCount=${result.insertedTradeCount} insertedTickerCount=${result.insertedTickerCount} insertFailureCount=${result.insertFailureCount}`,
    );
    process.exit(0);
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
      void writer.addBookSnapshot(row);
    },
    onTrade: (row) => {
      void writer.addTrade(row);
    },
    onTicker: (row) => {
      void writer.addTicker(row);
    },
    onError: (error) =>
      logger.error(`[worker] market-data-recorder | ERROR | error=${stringifyError(error)}`),
  });
}

export function parseRecorderVenue(value: string): RecorderVenue {
  return match(value)
    .with(...recorderVenues, (venue) => venue)
    .otherwise(() => {
      throw new Error(`Unsupported recorder venue: ${value}`);
    });
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
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
  await main();
}
