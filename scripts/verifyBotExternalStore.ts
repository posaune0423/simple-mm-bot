import { DIContainer } from "../src/application/di.ts";
import { ConfigLoader } from "../src/config.ts";

const maxTicks = parseIntegerArg("--maxTicks", 3);
const config = await ConfigLoader.load();
if (!config.quoteEngine.externalFair.enabled) {
  throw new Error("Set EXTERNAL_FAIR_ENABLED=true or enable quoteEngine.externalFair.enabled");
}
if (config.mode === "live") {
  throw new Error("verifyBotExternalStore refuses MODE=live; use MODE=paper");
}

const runtime = new DIContainer(config).buildExternalMarketRuntime();
if (!runtime) {
  throw new Error("External market runtime was not built");
}

try {
  for (const disposable of runtime.disposables) {
    await disposable.start?.();
  }

  let latestSnapshot: ReturnType<typeof runtime.provider.getLatestFairValue> | undefined;
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    await Bun.sleep(1000);
    latestSnapshot = runtime.provider.getLatestFairValue(Date.now());
    console.info(
      JSON.stringify({
        tick,
        status: latestSnapshot.status,
        fairMid: latestSnapshot.status === "unavailable" ? undefined : latestSnapshot.fairMid,
        maxAgeMs: latestSnapshot.status === "unavailable" ? undefined : latestSnapshot.maxAgeMs,
        used: latestSnapshot.used.map((component) => ({
          venue: component.venue,
          symbol: component.symbol,
          ageMs: component.ageMs,
          spreadBps: component.spreadBps,
          weight: component.weight,
        })),
        excluded: latestSnapshot.excluded,
      }),
    );
    if (latestSnapshot.status !== "unavailable") {
      break;
    }
  }

  if (!latestSnapshot || latestSnapshot.status === "unavailable") {
    throw new Error("External fair value stayed unavailable");
  }
  if (!Number.isFinite(latestSnapshot.fairMid)) {
    throw new Error("External fair value fairMid is not finite");
  }
  if (latestSnapshot.used.length < config.quoteEngine.externalFair.minSourceCount) {
    throw new Error(
      `External fair value used too few sources: used=${latestSnapshot.used.length} min=${config.quoteEngine.externalFair.minSourceCount}`,
    );
  }
} finally {
  for (const disposable of runtime.disposables) {
    await disposable.stop();
  }
}

function parseIntegerArg(name: string, fallback: number): number {
  const index = Bun.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = Bun.argv[index + 1];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
