import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { BulkMarketFeed } from "../../../src/adapters/bulk/BulkMarketFeed.ts";
import { BulkOrderGateway } from "../../../src/adapters/bulk/BulkOrderGateway.ts";
import { HistoricalMarketFeed } from "../../../src/adapters/paper/HistoricalMarketFeed.ts";
import { PaperOrderGateway } from "../../../src/adapters/paper/PaperOrderGateway.ts";
import { DIContainer, resolveCapitalMode } from "../../../src/application/di.ts";
import { ExternalMarketSubscriptionService } from "../../../src/application/services/ExternalMarketSubscriptionService.ts";
import type { LoadedAppConfig } from "../../../src/config.ts";

const TEST_DATABASE_URL = "postgresql://mm:mm@127.0.0.1:5432/mm_bot";

function config(
  mode: "live" | "paper" | "backtest",
  strategy: LoadedAppConfig["quoteEngine"]["strategy"] = {
    type: "avellaneda-stoikov",
    params: { gamma: 0.02, kappa: 1.5, kInv: 0.3 },
  },
): LoadedAppConfig {
  return {
    mode,
    venue: "bulk",
    market: "ETH-USD",
    connections: {
      bulk: {
        httpUrl: "https://api.bulk.trade",
        wsUrl: "wss://api.bulk.trade/ws",
        market: "ETH-USD",
        environment: "beta",
        maxLeverage: 5,
        fillPollIntervalMs: 2_000,
        privateKey: mode === "live" ? "11111111111111111111111111111111" : undefined,
      },
    },
    quoteEngine: {
      markWeight: 0.6,
      bookPriceSource: "micro",
      inventoryScale: 0.05,
      timeHorizonSec: 30,
      slideMarginThreshold: 0.12,
      defaultTimeInForce: "GTC",
      sizing: { positionSize: 0.01, budgetUsd: 100 },
      qualityGate: {
        enabled: false,
        action: "disable",
        minAverageMarkoutBps: 0,
        minSamples: 20,
        lookbackFills: 100,
        horizonsSec: [5, 30, 300],
      },
      externalFair: {
        enabled: false,
        mode: "replace_local",
        maxAgeMs: 500,
        minSourceCount: 2,
        maxSpreadBps: 10,
        maxDeviationBps: 20,
        sources: [],
      },
      strategy,
    },
    risk: { imrBuffer: 0.15, mmrBuffer: 0.08, maxPositionQty: 0.05 },
    bot: { intervalMs: 1000, postCancelOpenOrderSyncMode: "blocking" },
    shutdown: { closePositionPolicy: "always" },
    paper: { touchFillRatio: 0.5 },
    backtest: {
      market: "ETH",
      timeframe: "1h",
      from: "2024-01-01",
      to: "2024-01-07",
    },
  };
}

function configWithoutBulkPrivateKey(): LoadedAppConfig {
  const appConfig = config("live");
  if (appConfig.venue !== "bulk") {
    throw new Error("Expected bulk config");
  }
  appConfig.connections.bulk.privateKey = undefined;
  return appConfig;
}

describe("DIContainer Bulk venue", () => {
  let previousDatabaseUrl: string | undefined;

  beforeEach(() => {
    previousDatabaseUrl = Bun.env.DATABASE_URL;
    Bun.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) {
      delete Bun.env.DATABASE_URL;
    } else {
      Bun.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  test("resolves bulk paper to BulkMarketFeed and PaperOrderGateway", async () => {
    const bot = await new DIContainer(config("paper")).buildBot();
    const internals = bot as unknown as { marketFeed: unknown; orderGateway: unknown };

    expect(internals.marketFeed).toBeInstanceOf(BulkMarketFeed);
    expect(internals.orderGateway).toBeInstanceOf(PaperOrderGateway);
  });

  test("resolves bulk live to BulkMarketFeed and BulkOrderGateway", async () => {
    const bot = await new DIContainer(config("live")).buildBot();
    const internals = bot as unknown as { marketFeed: unknown; orderGateway: unknown };

    expect(internals.marketFeed).toBeInstanceOf(BulkMarketFeed);
    expect(internals.orderGateway).toBeInstanceOf(BulkOrderGateway);
    expect(
      (internals.orderGateway as { params: { maxLeverage?: number } }).params.maxLeverage,
    ).toBe(5);
    expect(
      (internals.orderGateway as { params: { pollIntervalMs?: number } }).params.pollIntervalMs,
    ).toBe(2_000);
    await (internals.orderGateway as BulkOrderGateway).dispose();
  });

  test("marks bulk beta live as mock capital and bulk mainnet live as real capital", () => {
    const betaConfig = config("live");
    const mainnetConfig = config("live");
    if (mainnetConfig.venue !== "bulk") {
      throw new Error("Expected bulk config");
    }
    mainnetConfig.connections.bulk.environment = "mainnet";

    expect(resolveCapitalMode(betaConfig)).toBe("beta_mock");
    expect(resolveCapitalMode(mainnetConfig)).toBe("real");
  });

  test("rejects bulk live without BULK_PRIVATE_KEY", async () => {
    await new DIContainer(configWithoutBulkPrivateKey()).buildBot().then(
      () => {
        throw new Error("Expected Bulk live without private key to reject");
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          "BULK_PRIVATE_KEY is required for live Bulk order placement",
        );
      },
    );
  });

  test("resolves bulk backtest to HistoricalMarketFeed and PaperOrderGateway", async () => {
    const bot = await new DIContainer(config("backtest")).buildBot();
    const internals = bot as unknown as { marketFeed: unknown; orderGateway: unknown };

    expect(internals.marketFeed).toBeInstanceOf(HistoricalMarketFeed);
    expect(internals.orderGateway).toBeInstanceOf(PaperOrderGateway);
  });

  test("passes the selected strategy name into metrics run metadata", async () => {
    const bot = await new DIContainer(
      config("paper", {
        type: "avellaneda-stoikov",
        params: { gamma: 0.01, kappa: 2, kInv: 0.1 },
      }),
    ).buildBot();
    const internals = bot as unknown as {
      metrics: { options: { strategyName: string } };
    };

    expect(internals.metrics.options.strategyName).toBe("avellaneda-stoikov");
  });

  test("does not attach external market runtime when externalFair is disabled", async () => {
    const bot = await new DIContainer(config("paper")).buildBot();
    const internals = bot as unknown as {
      options: { runtimeDisposables?: readonly unknown[] };
    };

    expect(internals.options.runtimeDisposables).toBeUndefined();
  });

  test("attaches external market runtime when externalFair is enabled", async () => {
    const appConfig = config("paper");
    appConfig.quoteEngine.externalFair = {
      enabled: true,
      mode: "replace_local",
      maxAgeMs: 500,
      minSourceCount: 2,
      maxSpreadBps: 10,
      maxDeviationBps: 20,
      sources: [
        {
          venue: "binance_usdm",
          symbol: "BTCUSDT",
          weight: 0.6,
          wsUrl: "wss://fstream.binance.com",
          channel: "bookTicker",
          reconnectDelayMs: 1_000,
        },
        {
          venue: "okx_swap",
          symbol: "BTC-USDT-SWAP",
          weight: 0.4,
          wsUrl: "wss://ws.okx.com:8443/ws/v5/public",
          channel: "bbo-tbt",
          reconnectDelayMs: 1_000,
        },
      ],
    };

    const bot = await new DIContainer(appConfig).buildBot();
    const internals = bot as unknown as {
      options: { runtimeDisposables?: readonly unknown[] };
    };

    expect(internals.options.runtimeDisposables).toHaveLength(1);
    expect(internals.options.runtimeDisposables?.[0]).toBeInstanceOf(
      ExternalMarketSubscriptionService,
    );
  });

  test("rejects externalFair config with fewer sources than minSourceCount", async () => {
    const appConfig = config("paper");
    appConfig.quoteEngine.externalFair = {
      enabled: true,
      mode: "replace_local",
      maxAgeMs: 500,
      minSourceCount: 2,
      maxSpreadBps: 10,
      maxDeviationBps: 20,
      sources: [
        {
          venue: "binance_usdm",
          symbol: "BTCUSDT",
          weight: 1,
          wsUrl: "wss://fstream.binance.com",
          channel: "bookTicker",
          reconnectDelayMs: 1_000,
        },
      ],
    };

    await new DIContainer(appConfig).buildBot().then(
      () => {
        throw new Error("Expected externalFair source validation to reject");
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "externalFair requires at least minSourceCount sources",
        );
      },
    );
  });
});
