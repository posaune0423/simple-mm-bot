import { count, desc, gte, max } from "drizzle-orm";

import { buildExternalMarketRecorderSubscriptions } from "../src/workers/externalMarketRecorderFactory.ts";
import { loadExternalMarketRecorderConfig } from "../src/workers/externalMarketRecorderConfig.ts";
import { ExternalMarketBufferedWriter } from "../src/application/services/ExternalMarketBufferedWriter.ts";
import { parseExternalMarketRealtimeArgs } from "../src/application/services/ExternalMarketRealtimeArgs.ts";
import { ExternalMarketRealtimeStats } from "../src/application/services/ExternalMarketRealtimeStats.ts";
import {
  renderExternalMarketRealtimeLog,
  renderExternalMarketRealtimeTui,
} from "../src/application/services/ExternalMarketRealtimeView.ts";
import { createPostgresClient } from "../src/infrastructure/db/postgres/client.ts";
import { PostgresExternalMarketRepository } from "../src/infrastructure/db/postgres/repository/PostgresExternalMarketRepository.ts";
import { externalMarketTopOfBookTable } from "../src/infrastructure/db/postgres/schema.ts";

const args = parseExternalMarketRealtimeArgs(Bun.argv, {
  isTty: process.stdout.isTTY === true,
});
const databaseUrl = requireEnv("DATABASE_URL");
const config = await loadExternalMarketRecorderConfig();
const postgresClient = createPostgresClient(databaseUrl);
const repository = new PostgresExternalMarketRepository(postgresClient.db);
const writer = new ExternalMarketBufferedWriter(repository, {
  flushIntervalMs: config.flushIntervalMs,
  maxBatchSize: config.maxBatchSize,
  topOfBook: config.topOfBook,
});
const subscriptions = buildExternalMarketRecorderSubscriptions(config);
const realtimeStats = new ExternalMarketRealtimeStats(config.sources, {
  windowMs: args.statsWindowMs,
});
const startedAt = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
let flush: Awaited<ReturnType<typeof writer.shutdown>> | undefined;

try {
  writer.start();
  timer = setInterval(() => {
    const statsSnapshot = realtimeStats.snapshot(Date.now());
    if (args.viewMode === "tui") {
      process.stdout.write(renderExternalMarketRealtimeTui(statsSnapshot));
      return;
    }
    console.log(renderExternalMarketRealtimeLog(statsSnapshot));
  }, args.refreshMs);
  for (const subscription of subscriptions) {
    subscription.start({
      onTopOfBook: () => {},
      onRecord: (record) => {
        realtimeStats.recordTopOfBook(record);
        void writer.addTopOfBook(record);
      },
      onError: (error) => {
        console.error(
          JSON.stringify({
            event: "subscription_error",
            venue: subscription.venue,
            symbol: subscription.symbol,
            error: String(error),
          }),
        );
      },
    });
  }

  await waitForStop(args.durationMs);
  clearInterval(timer);
  timer = undefined;
  for (const subscription of subscriptions) {
    subscription.stop();
  }
  flush = await writer.shutdown();

  const rows = await postgresClient.db
    .select({
      venue: externalMarketTopOfBookTable.venue,
      symbol: externalMarketTopOfBookTable.symbol,
      rows: count(),
    })
    .from(externalMarketTopOfBookTable)
    .where(gte(externalMarketTopOfBookTable.receivedAt, startedAt))
    .groupBy(externalMarketTopOfBookTable.venue, externalMarketTopOfBookTable.symbol);

  const latestBySource = await postgresClient.db
    .select({
      venue: externalMarketTopOfBookTable.venue,
      symbol: externalMarketTopOfBookTable.symbol,
      latestReceivedAt: max(externalMarketTopOfBookTable.receivedAt),
    })
    .from(externalMarketTopOfBookTable)
    .where(gte(externalMarketTopOfBookTable.receivedAt, startedAt))
    .groupBy(externalMarketTopOfBookTable.venue, externalMarketTopOfBookTable.symbol);

  const recentSample = await postgresClient.db
    .select()
    .from(externalMarketTopOfBookTable)
    .where(gte(externalMarketTopOfBookTable.receivedAt, startedAt))
    .orderBy(desc(externalMarketTopOfBookTable.receivedAt))
    .limit(20);

  const missing = config.sources.filter(
    (source) =>
      rows.find((row) => row.venue === source.venue && row.symbol === source.symbol) === undefined,
  );
  const invalid = recentSample.filter(
    (row) =>
      row.bidPrice >= row.askPrice ||
      !Number.isFinite(row.midPrice) ||
      !Number.isFinite(row.spreadBps) ||
      row.spreadBps < 0,
  );

  console.log(JSON.stringify({ flush, rows, latestBySource, recentSample }, null, 2));

  if (missing.length > 0) {
    throw new Error(`missing external market rows: ${JSON.stringify(missing)}`);
  }
  if (invalid.length > 0) {
    throw new Error(`invalid external market rows: ${JSON.stringify(invalid)}`);
  }

  for (const source of config.sources) {
    const latestForSource = latestBySource.find(
      (row) => row.venue === source.venue && row.symbol === source.symbol,
    );
    const latestReceivedAt =
      latestForSource?.latestReceivedAt === null ? undefined : latestForSource?.latestReceivedAt;
    if (latestReceivedAt === undefined || Date.now() - Number(latestReceivedAt) > 5_000) {
      throw new Error(`stale latest external row for ${source.venue}:${source.symbol}`);
    }
  }
} finally {
  if (timer !== undefined) {
    clearInterval(timer);
  }
  for (const subscription of subscriptions) {
    subscription.stop();
  }
  if (flush === undefined) {
    flush = await writer.shutdown();
  }
  await postgresClient.client.end();
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function waitForStop(durationMs: number | undefined): Promise<void> {
  if (durationMs !== undefined) {
    return Bun.sleep(durationMs);
  }
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
