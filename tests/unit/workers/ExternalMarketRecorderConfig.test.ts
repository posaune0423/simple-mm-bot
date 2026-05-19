import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { loadExternalMarketRecorderConfig } from "../../../src/workers/externalMarketRecorderConfig.ts";

const tempRoots: string[] = [];

describe("loadExternalMarketRecorderConfig", () => {
  afterEach(() => {
    delete Bun.env.EXTERNAL_MARKET_RECORDER_CONFIG_PATH;
    delete Bun.env.EXTERNAL_MARKET_FLUSH_INTERVAL_MS;
    delete Bun.env.EXTERNAL_MARKET_MAX_BATCH_SIZE;
    delete Bun.env.EXTERNAL_MARKET_TOP_OF_BOOK_SAMPLE_INTERVAL_MS;
    delete Bun.env.EXTERNAL_MARKET_TOP_OF_BOOK_STORE_RAW_JSON;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("defaults to low-cost sampled top-of-book storage", async () => {
    const config = await loadExternalMarketRecorderConfig();

    expect(config.topOfBook).toEqual({
      mode: "sampled_latest",
      sampleIntervalMs: 250,
      storeRawJson: false,
    });
  });

  test("loads top-of-book sampling settings from config file", async () => {
    Bun.env.EXTERNAL_MARKET_RECORDER_CONFIG_PATH = writeConfig(`
flushIntervalMs: 100
maxBatchSize: 500
topOfBook:
  mode: sampled_latest
  sampleIntervalMs: 100
  storeRawJson: true
sources:
  - venue: binance_usdm
    symbol: BTCUSDT
    weight: 1
    wsUrl: wss://fstream.binance.com
    channel: bookTicker
`);

    const config = await loadExternalMarketRecorderConfig();

    expect(config.topOfBook).toEqual({
      mode: "sampled_latest",
      sampleIntervalMs: 100,
      storeRawJson: true,
    });
  });
});

function writeConfig(content: string): string {
  const root = join(tmpdir(), `mmbot-external-recorder-config-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  const path = join(root, "worker.yml");
  writeFileSync(path, content.trimStart());
  return path;
}
