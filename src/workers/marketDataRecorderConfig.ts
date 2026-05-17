import * as v from "valibot";
import { parse as parseYaml } from "yaml";

import type { RecorderVenue } from "../domain/market-data/MarketDataRecord.ts";

const recorderVenueSchema = v.picklist([
  "bulk",
  "binance_usdm",
  "okx_swap",
  "bybit_linear",
]) satisfies v.GenericSchema<unknown, RecorderVenue>;
const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.gtValue(0));
const nonEmptyStringSchema = v.pipe(v.string(), v.minLength(1));
const urlStringSchema = v.pipe(v.string(), v.url());

const marketDataRecorderConfigSchema = v.object({
  venue: recorderVenueSchema,
  symbol: nonEmptyStringSchema,
  depth: positiveIntegerSchema,
  flushIntervalMs: positiveIntegerSchema,
  maxBatchSize: positiveIntegerSchema,
  connections: v.object({
    bulk: v.object({
      httpUrl: urlStringSchema,
      wsUrl: urlStringSchema,
    }),
  }),
});

export type MarketDataRecorderConfig = v.InferOutput<typeof marketDataRecorderConfigSchema>;

export async function loadMarketDataRecorderConfig(): Promise<MarketDataRecorderConfig> {
  const configPath = envValue("RECORDER_CONFIG_PATH");
  if (configPath !== undefined) {
    return parseRecorderConfig(await Bun.file(configPath).text());
  }

  return parseRecorderConfig({
    venue: envValue("RECORDER_VENUE") ?? "bulk",
    symbol: envValue("RECORDER_SYMBOL") ?? "BTC-USD",
    depth: parsePositiveInteger(envValue("RECORDER_DEPTH") ?? "10", "RECORDER_DEPTH"),
    flushIntervalMs: parsePositiveInteger(
      envValue("RECORDER_FLUSH_INTERVAL_MS") ?? "250",
      "RECORDER_FLUSH_INTERVAL_MS",
    ),
    maxBatchSize: parsePositiveInteger(
      envValue("RECORDER_MAX_BATCH_SIZE") ?? "1000",
      "RECORDER_MAX_BATCH_SIZE",
    ),
    connections: {
      bulk: {
        httpUrl: requireEnv("BULK_HTTP_URL"),
        wsUrl: requireEnv("BULK_WS_URL"),
      },
    },
  });
}

function parseRecorderConfig(input: string | object): MarketDataRecorderConfig {
  try {
    const parsed = typeof input === "string" ? parseYaml(input) : input;
    return v.parse(marketDataRecorderConfigSchema, parsed);
  } catch (error) {
    throw new Error("Recorder config validation failed", { cause: error });
  }
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireEnv(name: string): string {
  const value = envValue(name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function envValue(name: string): string | undefined {
  const value = Bun.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}
