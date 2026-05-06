import type { ResultAsync } from "neverthrow";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { avellanedaStoikovParamsSchema } from "./domain/strategy/avellaneda-stoikov/AvellanedaStoikovParams.ts";
import { env } from "./env.ts";
import type { AppError } from "./utils/errors.ts";
import { createAppError } from "./utils/errors.ts";
import { fromResult, tryCatch, tryCatchAsync } from "./utils/result.ts";

const timeInForceSchema = z.enum(["ALO", "GTC", "IOC"]);
const quoteSizingSchema = z.object({
  positionSize: z.number().positive(),
  budgetUsd: z.number().positive().optional(),
});

const strategySchema = z.object({
  type: z.literal("avellaneda-stoikov"),
  params: avellanedaStoikovParamsSchema,
});

const commonConfigSchema = z.object({
  mode: z.enum(["live", "paper", "backtest"]),
  quoteEngine: z.object({
    markWeight: z.number().min(0).max(1),
    inventoryScale: z.number().positive(),
    timeHorizonSec: z.number().positive(),
    slideMarginThreshold: z.number().min(0).max(1),
    defaultTimeInForce: timeInForceSchema.default("ALO"),
    sizing: quoteSizingSchema,
    strategy: strategySchema,
  }),
  risk: z.object({
    imrBuffer: z.number().min(0).max(1),
    mmrBuffer: z.number().min(0).max(1),
    maxPositionQty: z.number().positive(),
  }),
  bot: z.object({
    intervalMs: z.number().int().positive(),
  }),
  paper: z
    .object({
      touchFillRatio: z.number().min(0).max(1).default(0.5),
    })
    .default({ touchFillRatio: 0.5 }),
  backtest: z.object({
    market: z.string().min(1),
    timeframe: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
});

const appConfigSchema = z.discriminatedUnion("venue", [
  commonConfigSchema.extend({
    venue: z.literal("hyperliquid"),
    connections: z.object({
      hyperliquid: z.object({
        wsUrl: z.string().url(),
        httpUrl: z.string().url(),
        market: z.string().min(1),
        secretKey: z.string().optional(),
        accountAddress: z.string().optional(),
      }),
    }),
  }),
  commonConfigSchema.extend({
    venue: z.literal("bulk"),
    connections: z.object({
      bulk: z.object({
        wsUrl: z.string().url(),
        httpUrl: z.string().url(),
        market: z.string().min(1),
        nlevels: z.number().int().positive().optional(),
        maxLeverage: z.number().min(1).max(50).optional(),
        privateKey: z.string().optional(),
      }),
    }),
  }),
]);

export type AppConfig = z.infer<typeof appConfigSchema>;
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
        () => applyEnvOverrides(appConfigSchema.parse(parseYaml(interpolateEnv(text)))),
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
