import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { loadMarketDataRecorderConfig } from "../../../src/workers/marketDataRecorderConfig.ts";

const tempRoots: string[] = [];

describe("loadMarketDataRecorderConfig", () => {
  afterEach(() => {
    delete Bun.env.RECORDER_CONFIG_PATH;
    delete Bun.env.RECORDER_VENUE;
    delete Bun.env.RECORDER_SYMBOL;
    delete Bun.env.RECORDER_DEPTH;
    delete Bun.env.RECORDER_FLUSH_INTERVAL_MS;
    delete Bun.env.RECORDER_MAX_BATCH_SIZE;
    delete Bun.env.BULK_HTTP_URL;
    delete Bun.env.BULK_WS_URL;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("loads recorder settings from RECORDER_CONFIG_PATH", async () => {
    const path = writeConfig(`
venue: bulk
symbol: BTC-USD
depth: 20
flushIntervalMs: 500
maxBatchSize: 2000
connections:
  bulk:
    httpUrl: https://exchange-api.bulk.trade/api/v1
    wsUrl: wss://exchange-ws1.bulk.trade
`);
    Bun.env.RECORDER_CONFIG_PATH = path;

    const config = await loadMarketDataRecorderConfig();

    expect(config).toEqual({
      venue: "bulk",
      symbol: "BTC-USD",
      depth: 20,
      flushIntervalMs: 500,
      maxBatchSize: 2000,
      connections: {
        bulk: {
          httpUrl: "https://exchange-api.bulk.trade/api/v1",
          wsUrl: "wss://exchange-ws1.bulk.trade",
        },
      },
    });
  });

  test("falls back to legacy recorder environment variables when no config path is set", async () => {
    Bun.env.RECORDER_VENUE = "bulk";
    Bun.env.RECORDER_SYMBOL = "BTC-USD";
    Bun.env.RECORDER_DEPTH = "10";
    Bun.env.RECORDER_FLUSH_INTERVAL_MS = "250";
    Bun.env.RECORDER_MAX_BATCH_SIZE = "1000";
    Bun.env.BULK_HTTP_URL = "https://exchange-api.bulk.trade/api/v1";
    Bun.env.BULK_WS_URL = "wss://exchange-ws1.bulk.trade";

    const config = await loadMarketDataRecorderConfig();

    expect(config.depth).toBe(10);
    expect(config.flushIntervalMs).toBe(250);
    expect(config.maxBatchSize).toBe(1000);
    expect(config.connections.bulk.wsUrl).toBe("wss://exchange-ws1.bulk.trade");
  });

  test("rejects invalid YAML config values", async () => {
    Bun.env.RECORDER_CONFIG_PATH = writeConfig(`
venue: bulk
symbol: BTC-USD
depth: 0
flushIntervalMs: 250
maxBatchSize: 1000
connections:
  bulk:
    httpUrl: https://exchange-api.bulk.trade/api/v1
    wsUrl: wss://exchange-ws1.bulk.trade
`);

    let error: unknown;
    try {
      await loadMarketDataRecorderConfig();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Recorder config validation failed");
  });
});

function writeConfig(content: string): string {
  const root = join(tmpdir(), `mmbot-recorder-config-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  const path = join(root, "worker.yml");
  writeFileSync(path, content.trimStart());
  return path;
}
