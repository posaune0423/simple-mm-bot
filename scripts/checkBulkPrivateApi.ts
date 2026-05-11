import { BulkClient } from "bulk-ts-sdk";

import { ConfigLoader } from "../src/config.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { getErrorName, stringifyError } from "../src/utils/errors.ts";
import { logger } from "../src/utils/logger.ts";
import { DEFAULT_BULK_BETA_CONFIG_PATH } from "./lib/paths.ts";

interface CheckResult {
  ok: boolean;
  ms: number;
  error?: string;
  name?: string;
  status?: number;
  data?: unknown;
  marketCount?: number;
  marketFound?: boolean;
  tickerMarkPrice?: number | null;
  leverage?: number | null;
  openOrders?: number;
  positionSize?: number | null;
  positionUnrealizedPnl?: number | null;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function errorData(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return undefined;
  }
  return (error as { data?: unknown }).data;
}

export function summarizeError(
  error: unknown,
): Pick<CheckResult, "error" | "name" | "status" | "data"> {
  return {
    error: stringifyError(error),
    name: getErrorName(error),
    status: errorStatus(error),
    data: errorData(error),
  };
}

function maskAccount(account: string | undefined): string | null {
  if (account === undefined) {
    return null;
  }
  return `${account.slice(0, 6)}...${account.slice(-4)}`;
}

async function timed<T>(operation: () => Promise<T>): Promise<{ value?: T; result: CheckResult }> {
  const startedAt = Date.now();
  try {
    const value = await operation();
    return { value, result: { ok: true, ms: Date.now() - startedAt } };
  } catch (error) {
    return {
      result: {
        ok: false,
        ms: Date.now() - startedAt,
        ...summarizeError(error),
      },
    };
  }
}

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(argv: string[]): Promise<void> {
  const flags = parseFlagOptions(argv);
  const configPath = flags.config ?? DEFAULT_BULK_BETA_CONFIG_PATH;
  const attempts = positiveInt(flags.attempts, 1);
  const consecutivePassesRequired = positiveInt(flags["consecutive-passes"], 1);
  const delayMs = positiveInt(flags["delay-ms"], 30_000);
  const tryWsCancel = flags["try-ws-cancel"] === "true";
  const config = await ConfigLoader.load({ configPath });
  if (config.venue !== "bulk") {
    throw new Error(`Bulk preflight requires a bulk config: ${configPath}`);
  }

  const { bulk } = config.connections;
  const client = new BulkClient({
    httpUrl: bulk.httpUrl,
    wsUrl: bulk.wsUrl,
    privateKey: bulk.privateKey,
    timeoutMs: bulk.timeoutMs,
  });
  const account = client.accountPublicKey;
  if (!account) {
    throw new Error("Bulk private API preflight requires BULK_PRIVATE_KEY");
  }

  logger.info(
    `bulk_private_preflight.start config=${configPath} market=${bulk.market} attempts=${attempts} consecutivePasses=${consecutivePassesRequired} timeoutMs=${bulk.timeoutMs ?? "sdk_default"} account=${maskAccount(account)}`,
  );

  let consecutivePasses = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const publicMarket = await timed(async () => {
      const [markets, ticker] = await Promise.all([
        client.market.exchangeInfo(),
        client.market.ticker(bulk.market),
      ]);
      return { markets, ticker };
    });
    if (publicMarket.value !== undefined) {
      publicMarket.result.marketCount = publicMarket.value.markets.length;
      publicMarket.result.marketFound = publicMarket.value.markets.some(
        (market) => market.symbol === bulk.market,
      );
      publicMarket.result.tickerMarkPrice = publicMarket.value.ticker.markPrice ?? null;
    }

    const fullAccount = await timed(async () => client.account.fullAccount(account));
    if (fullAccount.value !== undefined) {
      fullAccount.result.leverage =
        fullAccount.value.leverageSettings?.find((entry) => entry.symbol === bulk.market)
          ?.leverage ?? null;
      const position = fullAccount.value.positions?.find((entry) => entry.symbol === bulk.market);
      fullAccount.result.positionSize = position?.size ?? null;
      fullAccount.result.positionUnrealizedPnl = position?.unrealizedPnl ?? null;
    }

    const openOrders = await timed(async () => client.account.openOrders(account));
    if (openOrders.value !== undefined) {
      openOrders.result.openOrders = openOrders.value.filter(
        (order) => order.symbol === bulk.market,
      ).length;
    }

    const cancelAll = await timed(async () => client.trade.cancelAll({ symbols: [bulk.market] }));
    const wsCancelAll =
      tryWsCancel && !cancelAll.result.ok
        ? await timed(async () =>
            client.trade.cancelAll(
              { symbols: [bulk.market] },
              { via: "ws", timeoutMs: bulk.timeoutMs },
            ),
          )
        : undefined;

    logger.log(
      JSON.stringify({
        attempt,
        publicMarket: publicMarket.result,
        fullAccount: fullAccount.result,
        openOrders: openOrders.result,
        cancelAll: cancelAll.result,
        wsCancelAll: wsCancelAll?.result,
      }),
    );

    const passed =
      publicMarket.result.ok &&
      publicMarket.result.marketFound === true &&
      fullAccount.result.ok &&
      openOrders.result.ok &&
      (cancelAll.result.ok || wsCancelAll?.result.ok === true);
    consecutivePasses = passed ? consecutivePasses + 1 : 0;

    if (consecutivePasses >= consecutivePassesRequired) {
      logger.info(
        `bulk_private_preflight.pass attempt=${attempt} consecutivePasses=${consecutivePasses}`,
      );
      return;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  throw new Error("Bulk private API preflight failed");
}

if (import.meta.main) {
  void main(Bun.argv.slice(2)).catch((error) => {
    logger.error(stringifyError(error));
    process.exitCode = 1;
  });
}
