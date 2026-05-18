import { buildExternalMarketRecorderSubscriptions } from "./externalMarketRecorderFactory.ts";
import { loadExternalMarketRecorderConfig } from "./externalMarketRecorderConfig.ts";
import { ExternalMarketBufferedWriter } from "../application/services/ExternalMarketBufferedWriter.ts";
import { createPostgresClient } from "../infrastructure/db/postgres/client.ts";
import { PostgresExternalMarketRepository } from "../infrastructure/db/postgres/repository/PostgresExternalMarketRepository.ts";
import { stringifyError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

async function main(): Promise<void> {
  const config = await loadExternalMarketRecorderConfig();
  const databaseUrl = requireEnv("DATABASE_URL");
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error("external-market-recorder requires PostgreSQL/TimescaleDB DATABASE_URL");
  }

  logger.info(
    `[worker] external-market-recorder | STARTUP | sources=${config.sources.map((source) => `${source.venue}:${source.symbol}`).join(",")} apiKeysDetected=${config.sources.filter((source) => source.apiKey !== undefined).length} database=postgres flushIntervalMs=${config.flushIntervalMs} maxBatchSize=${config.maxBatchSize} topOfBookMode=${config.topOfBook.mode} topOfBookSampleIntervalMs=${config.topOfBook.sampleIntervalMs} topOfBookStoreRawJson=${config.topOfBook.storeRawJson}`,
  );

  const postgresClient = createPostgresClient(databaseUrl);
  const repository = new PostgresExternalMarketRepository(postgresClient.db);
  const writer = new ExternalMarketBufferedWriter(repository, {
    flushIntervalMs: config.flushIntervalMs,
    maxBatchSize: config.maxBatchSize,
    topOfBook: config.topOfBook,
  });
  const subscriptions = buildExternalMarketRecorderSubscriptions(config);
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("[worker] external-market-recorder | SHUTDOWN_STARTED");
    for (const subscription of subscriptions) {
      try {
        await subscription.stop();
      } catch (error) {
        logger.error(
          `[worker] external-market-recorder | SUBSCRIPTION_STOP_FAILED | venue=${subscription.venue} symbol=${subscription.symbol} error=${stringifyError(error)}`,
        );
      }
    }
    try {
      const result = await writer.shutdown();
      logger.info(
        `[worker] external-market-recorder | SHUTDOWN_FLUSHED | insertedTopOfBookCount=${result.insertedTopOfBookCount} insertedTickerCount=${result.insertedTickerCount} insertedTradeCount=${result.insertedTradeCount} insertFailureCount=${result.insertFailureCount}`,
      );
    } catch (error) {
      logger.error(
        `[worker] external-market-recorder | SHUTDOWN_FLUSH_FAILED | error=${stringifyError(error)}`,
      );
    }
    try {
      await postgresClient.client.end();
    } catch (error) {
      logger.error(
        `[worker] external-market-recorder | SHUTDOWN_DB_CLOSE_FAILED | error=${stringifyError(error)}`,
      );
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
  for (const subscription of subscriptions) {
    subscription.start({
      onTopOfBook: () => {},
      onRecord: (record) => {
        void writer.addTopOfBook(record).catch((error: unknown) => {
          logger.error(
            `[worker] external-market-recorder | TOP_OF_BOOK_WRITE_FAILED | error=${stringifyError(error)}`,
          );
        });
      },
      onError: (error) =>
        logger.error(
          `[worker] external-market-recorder | SUBSCRIPTION_ERROR | venue=${subscription.venue} symbol=${subscription.symbol} error=${stringifyError(error)}`,
        ),
    });
  }
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
