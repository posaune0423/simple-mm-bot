import type { ResultAsync } from "neverthrow";
import * as v from "valibot";
import { parse as parseYaml } from "yaml";

import type { AvellanedaStoikovParams } from "./domain/strategy/avellaneda-stoikov/AvellanedaStoikovParams.ts";
import { env } from "./env.ts";
import type { AppError } from "./utils/errors.ts";
import { createAppError } from "./utils/errors.ts";
import { fromResult, tryCatch, tryCatchAsync } from "./utils/result.ts";

const modeSchema = v.picklist(["live", "paper", "backtest"]);
const positiveNumberSchema = v.pipe(v.number(), v.gtValue(0));
const nonNegativeNumberSchema = v.pipe(v.number(), v.minValue(0));
const zeroToOneNumberSchema = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.gtValue(0));
const nonEmptyStringSchema = v.pipe(v.string(), v.minLength(1));
const urlStringSchema = v.pipe(v.string(), v.url());

const timeInForceSchema = v.picklist(["ALO", "GTC", "IOC"]);
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
const quoteQualityGateSchema = v.optional(
  v.object({
    enabled: v.optional(v.boolean(), false),
    minAverageMarkoutBps: v.optional(v.number(), 0),
    minSamples: v.optional(positiveIntegerSchema, 20),
    lookbackFills: v.optional(positiveIntegerSchema, 100),
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
    inventoryScale: positiveNumberSchema,
    timeHorizonSec: positiveNumberSchema,
    minSpreadBps: v.optional(nonNegativeNumberSchema),
    slideMarginThreshold: zeroToOneNumberSchema,
    defaultTimeInForce: v.optional(timeInForceSchema, "ALO"),
    sizing: quoteSizingSchema,
    levels: v.optional(v.pipe(v.array(quoteLevelSchema), v.minLength(1))),
    qualityGate: quoteQualityGateSchema,
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
  }),
  bot: v.object({
    intervalMs: positiveIntegerSchema,
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
        privateKey: v.optional(v.string()),
      }),
    }),
  }),
]);

export type AppConfig = v.InferOutput<typeof appConfigSchema>;
export type AppMode = AppConfig["mode"];

interface LoadConfigOptions {
  configPath?: string;
}

function interpolateEnv(text: string): string {
  return text.replaceAll(/\$\{([A-Z0-9_]+)\}/g, (_match, key) => envValue(key) ?? "");
}

function envValue(key: string): string | undefined {
  return Bun.env[key] ?? (env as Record<string, string | undefined>)[key];
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  if (config.venue === "bulk") {
    return {
      ...config,
      mode: (envValue("MODE") as AppMode | undefined) ?? config.mode,
      connections: {
        bulk: {
          ...config.connections.bulk,
          privateKey: envValue("BULK_PRIVATE_KEY") ?? config.connections.bulk.privateKey,
        },
      },
    };
  }

  return {
    ...config,
    mode: (envValue("MODE") as AppMode | undefined) ?? config.mode,
    connections: {
      hyperliquid: {
        ...config.connections.hyperliquid,
        wsUrl: envValue("HL_WS_URL") ?? config.connections.hyperliquid.wsUrl,
        httpUrl: envValue("HL_HTTP_URL") ?? config.connections.hyperliquid.httpUrl,
        secretKey: envValue("HL_SECRET_KEY") ?? config.connections.hyperliquid.secretKey,
        accountAddress:
          envValue("HL_ACCOUNT_ADDRESS") ?? config.connections.hyperliquid.accountAddress,
      },
    },
  };
}

function loadConfig(options: LoadConfigOptions = {}): ResultAsync<AppConfig, AppError> {
  const configPath = options.configPath ?? env.CONFIG_PATH;

  return tryCatchAsync(Bun.file(configPath).text(), (error) =>
    createAppError("config.read_failed", `Failed to read config: ${configPath}`, error),
  ).andThen((text) =>
    fromResult(
      tryCatch(
        () => applyEnvOverrides(v.parse(appConfigSchema, parseYaml(interpolateEnv(text)))),
        (error) => createAppError("config.invalid", "Config validation failed", error),
      ),
    ),
  );
}

export class ConfigLoader {
  static async load(options: LoadConfigOptions = {}): Promise<AppConfig> {
    const result = await loadConfig(options);
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }
}
