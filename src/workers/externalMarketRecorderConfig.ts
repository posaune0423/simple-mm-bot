import * as v from "valibot";
import { parse as parseYaml } from "yaml";

import type { ExternalVenueId } from "../domain/external-market/ExternalMarketTypes.ts";

const externalVenueSchema = v.picklist([
  "binance_usdm",
  "okx_swap",
  "bybit_linear",
]) satisfies v.GenericSchema<unknown, ExternalVenueId>;
const positiveNumberSchema = v.pipe(v.number(), v.gtValue(0));
const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.gtValue(0));
const nonEmptyStringSchema = v.pipe(v.string(), v.minLength(1));
const urlStringSchema = v.pipe(v.string(), v.url());
const topOfBookModeSchema = v.picklist(["all", "sampled_latest"]);

const sourceSchema = v.object({
  venue: externalVenueSchema,
  symbol: nonEmptyStringSchema,
  weight: positiveNumberSchema,
  wsUrl: urlStringSchema,
  channel: nonEmptyStringSchema,
  reconnectDelayMs: v.optional(positiveIntegerSchema, 1_000),
  apiKey: v.optional(v.string()),
});

const externalMarketRecorderConfigSchema = v.object({
  flushIntervalMs: positiveIntegerSchema,
  maxBatchSize: positiveIntegerSchema,
  topOfBook: v.optional(
    v.object({
      mode: v.optional(topOfBookModeSchema),
      sampleIntervalMs: v.optional(positiveIntegerSchema),
      storeRawJson: v.optional(v.boolean()),
    }),
  ),
  sources: v.pipe(v.array(sourceSchema), v.minLength(1)),
});

type ParsedExternalMarketRecorderConfig = v.InferOutput<typeof externalMarketRecorderConfigSchema>;

export type ExternalMarketRecorderConfig = Omit<ParsedExternalMarketRecorderConfig, "topOfBook"> &
  Readonly<{
    topOfBook: {
      mode: "all" | "sampled_latest";
      sampleIntervalMs: number;
      storeRawJson: boolean;
    };
  }>;

export async function loadExternalMarketRecorderConfig(): Promise<ExternalMarketRecorderConfig> {
  const configPath = envValue("EXTERNAL_MARKET_RECORDER_CONFIG_PATH");
  if (configPath !== undefined) {
    return parseExternalMarketRecorderConfig(await Bun.file(configPath).text());
  }

  const symbols = {
    binance: envValue("BINANCE_USDM_SYMBOL") ?? "BTCUSDT",
    okx: envValue("OKX_SWAP_SYMBOL") ?? "BTC-USDT-SWAP",
    bybit: envValue("BYBIT_LINEAR_SYMBOL") ?? "BTCUSDT",
  };

  return parseExternalMarketRecorderConfig({
    flushIntervalMs: parsePositiveInteger(
      envValue("EXTERNAL_MARKET_FLUSH_INTERVAL_MS") ?? "250",
      "EXTERNAL_MARKET_FLUSH_INTERVAL_MS",
    ),
    maxBatchSize: parsePositiveInteger(
      envValue("EXTERNAL_MARKET_MAX_BATCH_SIZE") ?? "1000",
      "EXTERNAL_MARKET_MAX_BATCH_SIZE",
    ),
    topOfBook: {
      mode: envValue("EXTERNAL_MARKET_TOP_OF_BOOK_MODE") ?? "sampled_latest",
      sampleIntervalMs: parsePositiveInteger(
        envValue("EXTERNAL_MARKET_TOP_OF_BOOK_SAMPLE_INTERVAL_MS") ?? "250",
        "EXTERNAL_MARKET_TOP_OF_BOOK_SAMPLE_INTERVAL_MS",
      ),
      storeRawJson: parseBoolean(
        envValue("EXTERNAL_MARKET_TOP_OF_BOOK_STORE_RAW_JSON") ?? "false",
        "EXTERNAL_MARKET_TOP_OF_BOOK_STORE_RAW_JSON",
      ),
    },
    sources: [
      {
        venue: "binance_usdm",
        symbol: symbols.binance,
        weight: 0.5,
        wsUrl: envValue("BINANCE_USDM_WS_URL") ?? "wss://fstream.binance.com",
        channel: "bookTicker",
        reconnectDelayMs: 1_000,
        apiKey: envValue("BINANCE_USDM_API_KEY") ?? envValue("BINANCE_API_KEY"),
      },
      {
        venue: "okx_swap",
        symbol: symbols.okx,
        weight: 0.3,
        wsUrl: envValue("OKX_WS_URL") ?? "wss://ws.okx.com:8443/ws/v5/public",
        channel: "bbo-tbt",
        reconnectDelayMs: 1_000,
        apiKey: envValue("OKX_API_KEY"),
      },
      {
        venue: "bybit_linear",
        symbol: symbols.bybit,
        weight: 0.2,
        wsUrl: envValue("BYBIT_LINEAR_WS_URL") ?? "wss://stream.bybit.com/v5/public/linear",
        channel: "orderbook.1",
        reconnectDelayMs: 1_000,
        apiKey: envValue("BYBIT_API_KEY"),
      },
    ],
  });
}

function parseExternalMarketRecorderConfig(input: string | object): ExternalMarketRecorderConfig {
  try {
    const parsed = typeof input === "string" ? parseYaml(input) : input;
    return normalizeExternalMarketRecorderConfig(
      v.parse(externalMarketRecorderConfigSchema, parsed),
    );
  } catch (error) {
    throw new Error("External market recorder config validation failed", { cause: error });
  }
}

function normalizeExternalMarketRecorderConfig(
  config: ParsedExternalMarketRecorderConfig,
): ExternalMarketRecorderConfig {
  return {
    ...config,
    topOfBook: {
      mode: config.topOfBook?.mode ?? "sampled_latest",
      sampleIntervalMs: config.topOfBook?.sampleIntervalMs ?? 250,
      storeRawJson: config.topOfBook?.storeRawJson ?? false,
    },
  };
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(value: string, name: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function envValue(name: string): string | undefined {
  const value = Bun.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}
