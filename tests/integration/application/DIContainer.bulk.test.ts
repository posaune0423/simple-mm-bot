import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { BulkMarketFeed } from "../../../src/adapters/bulk/BulkMarketFeed.ts";
import { BulkOrderGateway } from "../../../src/adapters/bulk/BulkOrderGateway.ts";
import { HistoricalMarketFeed } from "../../../src/adapters/paper/HistoricalMarketFeed.ts";
import { PaperOrderGateway } from "../../../src/adapters/paper/PaperOrderGateway.ts";
import { DIContainer, resolveCapitalMode } from "../../../src/application/di.ts";
import type { LoadedAppConfig } from "../../../src/config.ts";

const TEST_DB_DIR = join(process.cwd(), "data", "test-dbs", "di");

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

function fundingAwareStrategy(alphaEnabled: boolean): LoadedAppConfig["quoteEngine"]["strategy"] {
  return {
    type: "funding-aware",
    params: {
      gamma: 0,
      kappa: 625,
      kInv: 2,
      alpha: {
        enabled: alphaEnabled,
        source: alphaEnabled ? "allora" : "none",
        chainSlug: "testnet",
        asset: "BTC",
        timeframe: "5m",
        pollIntervalMs: 60_000,
        staleMs: 420_000,
        calibrationWeight: 0.04,
        minAlphaDriftBps: 0.25,
        maxAlphaDriftBps: 3,
        maxRawDriftBps: 200,
        maxCiWidthBps: 250,
      },
      targetInventory: {
        maxQty: 0.35,
        alphaQtyPerBps: 0.025,
      },
      funding: {
        rateHorizonSec: 3600,
        holdingHorizonSec: 300,
        spreadWideningBpsPerAbsFundingBps: 0.1,
      },
    },
  };
}

describe("DIContainer Bulk venue", () => {
  let previousDatabaseUrl: string | undefined;
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    previousDatabaseUrl = Bun.env.DATABASE_URL;
    await mkdir(TEST_DB_DIR, { recursive: true });
    tempDir = await mkdtemp(join(TEST_DB_DIR, "run-"));
    dbPath = join(tempDir, "di.db");
    Bun.env.DATABASE_URL = `file:${dbPath}`;
  });

  afterEach(async () => {
    if (previousDatabaseUrl === undefined) {
      delete Bun.env.DATABASE_URL;
    } else {
      Bun.env.DATABASE_URL = previousDatabaseUrl;
    }
    await rm(tempDir, { force: true, recursive: true });
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

  test("creates Allora runtime provider only when funding-aware alpha uses Allora", async () => {
    const pmmBot = await new DIContainer(config("paper")).buildBot();
    const fundingWithoutAlloraBot = await new DIContainer(
      config("paper", fundingAwareStrategy(false)),
    ).buildBot();
    const fundingWithAlloraBot = await new DIContainer(
      config("paper", fundingAwareStrategy(true)),
    ).buildBot();

    const pmmInternals = pmmBot as unknown as {
      options: { runtimeDisposables?: readonly unknown[] };
    };
    const fundingWithoutAlloraInternals = fundingWithoutAlloraBot as unknown as {
      options: { runtimeDisposables?: readonly unknown[] };
    };
    const fundingWithAlloraInternals = fundingWithAlloraBot as unknown as {
      options: { runtimeDisposables?: readonly { start?: () => void; stop: () => void }[] };
    };

    expect(pmmInternals.options.runtimeDisposables).toEqual([]);
    expect(fundingWithoutAlloraInternals.options.runtimeDisposables).toEqual([]);
    expect(fundingWithAlloraInternals.options.runtimeDisposables).toHaveLength(1);
    expect(fundingWithAlloraInternals.options.runtimeDisposables?.[0]?.start).toBeFunction();
    expect(fundingWithAlloraInternals.options.runtimeDisposables?.[0]?.stop).toBeFunction();
  });
});
