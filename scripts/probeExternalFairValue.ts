import { buildExternalMarketSubscription } from "../src/adapters/cex/ExternalMarketSubscriptionFactory.ts";
import { topOfBookRecordFromUpdate } from "../src/adapters/cex/normalization.ts";
import { ExternalMarketSubscriptionService } from "../src/application/services/ExternalMarketSubscriptionService.ts";
import { parseExternalMarketRealtimeArgs } from "../src/application/services/ExternalMarketRealtimeArgs.ts";
import { ExternalMarketRealtimeStats } from "../src/application/services/ExternalMarketRealtimeStats.ts";
import {
  renderExternalMarketRealtimeLog,
  renderExternalMarketRealtimeTui,
} from "../src/application/services/ExternalMarketRealtimeView.ts";
import { ConfigLoader } from "../src/config.ts";
import type { ExternalTopOfBookUpdate } from "../src/domain/external-market/ExternalMarketTypes.ts";
import { ExternalMarketFairValueCalculator } from "../src/domain/services/ExternalMarketFairValueCalculator.ts";
import type { IExternalMarketTopOfBookWriter } from "../src/domain/ports/IExternalMarketTopOfBookStore.ts";
import { ExternalMarketTopOfBookStore } from "../src/infrastructure/memory/ExternalMarketTopOfBookStore.ts";

const args = parseExternalMarketRealtimeArgs(Bun.argv, {
  isTty: process.stdout.isTTY === true,
});

const config = await ConfigLoader.load();
const externalFair = config.quoteEngine.externalFair;
if (externalFair.sources.length === 0) {
  throw new Error("quoteEngine.externalFair.sources must not be empty");
}

const store = new ExternalMarketTopOfBookStore(externalFair.sources);
const calculator = new ExternalMarketFairValueCalculator({
  sources: externalFair.sources,
  maxAgeMs: externalFair.maxAgeMs,
  minSourceCount: externalFair.minSourceCount,
  maxSpreadBps: externalFair.maxSpreadBps,
  maxDeviationBps: externalFair.maxDeviationBps,
});
const realtimeStats = new ExternalMarketRealtimeStats(externalFair.sources, {
  windowMs: args.statsWindowMs,
});
const service = new ExternalMarketSubscriptionService(
  externalFair.sources.map(buildExternalMarketSubscription),
  {
    update(update: ExternalTopOfBookUpdate): boolean {
      const accepted = store.update(update);
      if (accepted) {
        realtimeStats.recordTopOfBook(topOfBookRecordFromUpdate(update));
      }
      return accepted;
    },
  } satisfies IExternalMarketTopOfBookWriter,
);

await service.start();
const startedAt = Date.now();
const timer = setInterval(() => {
  const nowMs = Date.now();
  const snapshot = calculator.compute(store.readLatest(), nowMs);
  const statsSnapshot = realtimeStats.snapshot(nowMs);
  const fairValue = {
    status: snapshot.status,
    fairMid: snapshot.fairMid,
    fairBid: snapshot.fairBid,
    fairAsk: snapshot.fairAsk,
    maxAgeMs: snapshot.maxAgeMs,
    storeVersion: store.getVersion(),
    excludedCount: snapshot.excluded.length,
  };
  if (args.viewMode === "tui") {
    process.stdout.write(renderExternalMarketRealtimeTui(statsSnapshot, fairValue));
    return;
  }
  console.log(renderExternalMarketRealtimeLog(statsSnapshot, fairValue));
}, args.refreshMs);

await waitForStop(args.durationMs);
clearInterval(timer);
service.stop();

const finalSnapshot = calculator.compute(store.readLatest(), Date.now());
if (!args.watch) {
  if (finalSnapshot.status === "unavailable" || !Number.isFinite(finalSnapshot.fairMid)) {
    throw new Error(
      `external fair unavailable after ${Date.now() - startedAt}ms: ${JSON.stringify(finalSnapshot)}`,
    );
  }
  if (finalSnapshot.used.length < externalFair.minSourceCount) {
    throw new Error(`insufficient external fair sources: ${finalSnapshot.used.length}`);
  }
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
