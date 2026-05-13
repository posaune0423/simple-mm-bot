import type { ResultAsync } from "neverthrow";
import { match } from "ts-pattern";
import * as v from "valibot";
import { parse as parseYaml } from "yaml";

import type { AvellanedaStoikovParams } from "./domain/quote-models/AvellanedaStoikovQuoteModel.ts";
import type { BookPriceSource } from "./domain/services/FairPriceCalculator.ts";
import { env } from "./env.ts";
import { fromResult, tryCatch, tryCatchAsync } from "./utils/result.ts";

const modeSchema = v.picklist(["live", "paper", "backtest"]);
const positiveNumberSchema = v.pipe(v.number(), v.gtValue(0));
const nonNegativeNumberSchema = v.pipe(v.number(), v.minValue(0));
const zeroToOneNumberSchema = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.gtValue(0));
const nonEmptyStringSchema = v.pipe(v.string(), v.minLength(1));
const urlStringSchema = v.pipe(v.string(), v.url());

const timeInForceSchema = v.picklist(["ALO", "GTC", "IOC"]);
const bookPriceSourceSchema = v.optional(
  v.picklist(["micro", "vamp"]) satisfies v.GenericSchema<unknown, BookPriceSource>,
  "micro" as const,
);
const quoteSizingSchema = v.object({
  positionSize: positiveNumberSchema,
  budgetUsd: v.optional(positiveNumberSchema),
  bidSizeMultiplier: v.optional(nonNegativeNumberSchema),
  askSizeMultiplier: v.optional(nonNegativeNumberSchema),
  bidDistanceMultiplier: v.optional(positiveNumberSchema),
  askDistanceMultiplier: v.optional(positiveNumberSchema),
});
const quoteLevelSchema = v.object({
  halfSpreadBps: positiveNumberSchema,
  sizeUsd: positiveNumberSchema,
});
const markoutFeedbackGateSchema = v.optional(
  v.object({
    enabled: v.optional(v.boolean(), false),
    minAverageMarkoutBps: v.optional(v.number(), 0),
    minSamples: v.optional(positiveIntegerSchema, 20),
    lookbackFills: v.optional(positiveIntegerSchema, 100),
    maxFillAgeMs: v.optional(positiveIntegerSchema),
    horizonsSec: v.optional(v.pipe(v.array(positiveIntegerSchema), v.minLength(1)), [5, 30, 300]),
  }),
  {
    enabled: false,
    minAverageMarkoutBps: 0,
    minSamples: 20,
    lookbackFills: 100,
    horizonsSec: [5, 30, 300],
  },
);

const avellanedaStoikovParamsSchema = v.object({
  gamma: v.pipe(v.number(), v.minValue(0), v.maxValue(0.5)),
  kappa: positiveNumberSchema,
  kInv: v.pipe(v.number(), v.minValue(0), v.maxValue(2)),
}) satisfies v.GenericSchema<unknown, AvellanedaStoikovParams>;

const strategySchema = v.object({
  type: v.literal("avellaneda-stoikov"),
  params: avellanedaStoikovParamsSchema,
});

const shutdownSchema = v.optional(
  v.object({
    closePositionPolicy: v.optional(v.picklist(["always", "emergency_only"]), "always"),
  }),
  { closePositionPolicy: "always" as const },
);

const commonConfigEntries = {
  mode: modeSchema,
  quoteEngine: v.object({
    markWeight: zeroToOneNumberSchema,
    bookPriceSource: bookPriceSourceSchema,
    inventoryScale: positiveNumberSchema,
    timeHorizonSec: positiveNumberSchema,
    minSpreadBps: v.optional(nonNegativeNumberSchema),
    slideMarginThreshold: zeroToOneNumberSchema,
    defaultTimeInForce: v.optional(timeInForceSchema, "ALO"),
    sizing: quoteSizingSchema,
    levels: v.optional(v.pipe(v.array(quoteLevelSchema), v.minLength(1))),
    qualityGate: markoutFeedbackGateSchema,
    strategy: strategySchema,
  }),
  risk: v.object({
    imrBuffer: zeroToOneNumberSchema,
    mmrBuffer: zeroToOneNumberSchema,
    maxPositionQty: positiveNumberSchema,
    reduceTriggerQty: v.optional(positiveNumberSchema),
    reduceTargetQty: v.optional(nonNegativeNumberSchema),
    maxUnrealizedLossUsd: v.optional(positiveNumberSchema),
    maxAdverseMoveBps: v.optional(positiveNumberSchema),
    maxBookAgeMs: v.optional(positiveIntegerSchema),
    maxTickerAgeMs: v.optional(positiveIntegerSchema),
    maxAccountAgeMs: v.optional(positiveIntegerSchema),
    maxPositionAgeMs: v.optional(positiveIntegerSchema),
  }),
  bot: v.object({
    intervalMs: positiveIntegerSchema,
    maxRestingMs: v.optional(positiveIntegerSchema),
    exchangeOpenOrderSyncIntervalMs: v.optional(positiveIntegerSchema),
  }),
  shutdown: shutdownSchema,
  paper: v.optional(
    v.object({
      touchFillRatio: v.optional(zeroToOneNumberSchema, 0.5),
    }),
    { touchFillRatio: 0.5 },
  ),
  backtest: v.object({
    market: nonEmptyStringSchema,
    timeframe: nonEmptyStringSchema,
    from: nonEmptyStringSchema,
    to: nonEmptyStringSchema,
  }),
};

const appConfigSchema = v.variant("venue", [
  v.object({
    ...commonConfigEntries,
    venue: v.literal("hyperliquid"),
    connections: v.object({
      hyperliquid: v.object({
        wsUrl: urlStringSchema,
        httpUrl: urlStringSchema,
        market: nonEmptyStringSchema,
        secretKey: v.optional(v.string()),
        accountAddress: v.optional(v.string()),
      }),
    }),
  }),
  v.object({
    ...commonConfigEntries,
    venue: v.literal("bulk"),
    connections: v.object({
      bulk: v.object({
        wsUrl: urlStringSchema,
        httpUrl: urlStringSchema,
        market: nonEmptyStringSchema,
        environment: v.optional(v.picklist(["beta", "mainnet"]), "mainnet"),
        nlevels: v.optional(positiveIntegerSchema),
        timeoutMs: v.optional(positiveIntegerSchema),
        maxLeverage: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(50))),
        marketWsReconnectAfterMs: v.optional(positiveIntegerSchema),
        privateKey: v.optional(v.string()),
      }),
    }),
  }),
]);

export type AppConfig = v.InferOutput<typeof appConfigSchema>;
export type LoadedAppConfig = AppConfig & { market: string };
export type AppMode = AppConfig["mode"];

interface LoadConfigOptions {
  configPath?: string;
  venue?: string;
  preset?: string;
}

class ConfigError extends Error {
  readonly context: Readonly<Record<string, string>>;

  constructor(
    readonly code: "config.read_failed" | "config.invalid",
    message: string,
    options: { context?: Readonly<Record<string, string>>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ConfigError";
    this.context = options.context ?? {};
  }
}

const DEFAULT_CONFIG_VENUE = "bulk";
const DEFAULT_CONFIG_PRESET = "beta";
const configPathSegmentSchema = /^[a-z0-9][a-z0-9._-]*$/;

function interpolateEnv(text: string): string {
  return text.replaceAll(/\$\{([A-Z0-9_]+)\}/g, (_match, key) => envValue(key) ?? "");
}

function envValue(key: string): string | undefined {
  return Bun.env[key] ?? (env as Record<string, string | undefined>)[key];
}

function resolveConfigPath(options: LoadConfigOptions = {}): string {
  const explicitPath = options.configPath ?? configSelectionEnvValue("CONFIG_PATH");
  if (explicitPath !== undefined) {
    return explicitPath;
  }

  const venue = options.venue ?? configSelectionEnvValue("CONFIG_VENUE") ?? DEFAULT_CONFIG_VENUE;
  const preset =
    options.preset ?? configSelectionEnvValue("CONFIG_PRESET") ?? DEFAULT_CONFIG_PRESET;
  assertConfigPathSegment("venue", venue);
  assertConfigPathSegment("preset", preset);
  return `config/${venue}/${preset}.yml`;
}

function configSelectionEnvValue(key: "CONFIG_PATH" | "CONFIG_VENUE" | "CONFIG_PRESET") {
  const value = Bun.env[key];
  return value === undefined || value === "" ? undefined : value;
}

function assertConfigPathSegment(label: "venue" | "preset", value: string): void {
  if (!configPathSegmentSchema.test(value)) {
    throw new Error(`Invalid config ${label}: ${value}`);
  }
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  return match(config)
    .with({ venue: "bulk" }, (bulkConfig) => ({
      ...bulkConfig,
      mode: (envValue("MODE") as AppMode | undefined) ?? bulkConfig.mode,
      connections: {
        bulk: {
          ...bulkConfig.connections.bulk,
          privateKey: envValue("BULK_PRIVATE_KEY") ?? bulkConfig.connections.bulk.privateKey,
        },
      },
    }))
    .with({ venue: "hyperliquid" }, (hyperliquidConfig) => ({
      ...hyperliquidConfig,
      mode: (envValue("MODE") as AppMode | undefined) ?? hyperliquidConfig.mode,
      connections: {
        hyperliquid: {
          ...hyperliquidConfig.connections.hyperliquid,
          wsUrl: envValue("HL_WS_URL") ?? hyperliquidConfig.connections.hyperliquid.wsUrl,
          httpUrl: envValue("HL_HTTP_URL") ?? hyperliquidConfig.connections.hyperliquid.httpUrl,
          secretKey:
            envValue("HL_SECRET_KEY") ?? hyperliquidConfig.connections.hyperliquid.secretKey,
          accountAddress:
            envValue("HL_ACCOUNT_ADDRESS") ??
            hyperliquidConfig.connections.hyperliquid.accountAddress,
        },
      },
    }))
    .exhaustive();
}

function normalizeConfig(config: AppConfig): LoadedAppConfig {
  return {
    ...config,
    market:
      config.venue === "bulk"
        ? config.connections.bulk.market
        : config.connections.hyperliquid.market,
  };
}

function loadConfig(options: LoadConfigOptions = {}): ResultAsync<LoadedAppConfig, ConfigError> {
  const configPath = resolveConfigPath(options);

  return tryCatchAsync(
    Bun.file(configPath).text(),
    (error) =>
      new ConfigError("config.read_failed", `Failed to read config: ${configPath}`, {
        context: { configPath },
        cause: error,
      }),
  ).andThen((text) =>
    fromResult(
      tryCatch(
        () =>
          normalizeConfig(
            applyEnvOverrides(v.parse(appConfigSchema, parseYaml(interpolateEnv(text)))),
          ),
        (error) =>
          new ConfigError("config.invalid", "Config validation failed", {
            context: { configPath },
            cause: error,
          }),
      ),
    ),
  );
}

export class ConfigLoader {
  static async load(options: LoadConfigOptions = {}): Promise<LoadedAppConfig> {
    const result = await loadConfig(options);
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }
}
