import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { BulkMarketFeed } from "../../src/adapters/bulk/BulkMarketFeed.ts";
import { BulkOrderGateway } from "../../src/adapters/bulk/BulkOrderGateway.ts";
import { PaperOrderGateway } from "../../src/adapters/paper/PaperOrderGateway.ts";
import { DIContainer } from "../../src/application/di.ts";
import type { AppConfig } from "../../src/config.ts";

function config(mode: "live" | "paper" | "backtest"): AppConfig {
  return {
    mode,
    venue: "bulk",
    connections: {
      bulk: {
        httpUrl: "https://api.bulk.trade",
        wsUrl: "wss://api.bulk.trade/ws",
        market: "ETH-USD",
        maxLeverage: 5,
        privateKey: mode === "live" ? "11111111111111111111111111111111" : undefined,
      },
    },
    quoteEngine: {
      markWeight: 0.6,
      inventoryScale: 0.05,
      timeHorizonSec: 30,
      slideMarginThreshold: 0.12,
      defaultTimeInForce: "GTC",
      sizing: { positionSize: 0.01, budgetUsd: 100 },
      strategy: { type: "avellaneda-stoikov", params: { gamma: 0.02, kappa: 1.5, kInv: 0.3 } },
    },
    risk: { imrBuffer: 0.15, mmrBuffer: 0.08, maxPositionQty: 0.05 },
    bot: { intervalMs: 1000 },
    paper: { touchFillRatio: 0.5 },
    backtest: {
      market: "ETH",
      timeframe: "1h",
      from: "2024-01-01",
      to: "2024-01-07",
    },
  };
}

function configWithoutBulkPrivateKey(): AppConfig {
  const appConfig = config("live");
  if (appConfig.venue !== "bulk") {
    throw new Error("Expected bulk config");
  }
  appConfig.connections.bulk.privateKey = undefined;
  return appConfig;
}

describe("DIContainer Bulk venue", () => {
  let previousDbPath: string | undefined;
  let previousDatabaseUrl: string | undefined;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    previousDbPath = Bun.env.DB_PATH;
    previousDatabaseUrl = Bun.env.DATABASE_URL;
    tempDir = join(process.cwd(), "tmp-tests-di", randomUUID());
    dbPath = join(tempDir, "di.db");
    Bun.env.DB_PATH = dbPath;
    delete Bun.env.DATABASE_URL;
  });

  afterEach(async () => {
    if (previousDbPath === undefined) {
      delete Bun.env.DB_PATH;
    } else {
      Bun.env.DB_PATH = previousDbPath;
    }
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
    (internals.orderGateway as BulkOrderGateway).dispose();
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

  test("rejects bulk backtest explicitly", async () => {
    await new DIContainer(config("backtest")).buildBot().then(
      () => {
        throw new Error("Expected Bulk backtest to reject");
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Bulk venue does not support backtest mode");
      },
    );
  });
});
