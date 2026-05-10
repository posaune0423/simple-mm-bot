import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

import { ConfigLoader } from "../src/config.ts";

const DEFAULT_BULK_BETA_CONFIG_PATH = "config/config.bulk.beta.yml";
const DEFAULT_CONFIG_PATH = DEFAULT_BULK_BETA_CONFIG_PATH;
const DEFAULT_SQLITE_DB_PATH = "data/mm.db";

describe("ConfigLoader", () => {
  test("uses data/mm.db as the default SQLite database path", () => {
    expect(DEFAULT_SQLITE_DB_PATH).toBe("data/mm.db");
  });

  test("keeps the sample env file aligned with the default SQLite database path", async () => {
    const envExample = await Bun.file(".env.example").text();

    expect(envExample).toContain(`DB_PATH=${DEFAULT_SQLITE_DB_PATH}`);
    expect(envExample).not.toContain("DB_PATH=data/mmbot.db");
  });

  test("loads quote sizing from committed config", async () => {
    const config = await ConfigLoader.load({ configPath: "config/config.paper.yml" });

    expect(config.quoteEngine.sizing.positionSize).toBe(0.05);
    expect(config.quoteEngine.sizing.budgetUsd).toBe(250);
  });

  test("loads committed Bulk beta config tuned to deploy the daily mock balance", async () => {
    const rawConfig = parseYaml(await Bun.file("config/config.bulk.beta.yml").text()) as {
      mode?: string;
    };
    expect(rawConfig.mode).toBe("live");

    const config = await ConfigLoader.load({ configPath: "config/config.bulk.beta.yml" });

    expect(config.venue).toBe("bulk");
    if (config.venue !== "bulk") {
      throw new Error("Expected bulk config");
    }
    expect(config.connections.bulk.environment).toBe("beta");
    expect(config.connections.bulk.httpUrl).toBe("https://exchange-api.bulk.trade/api/v1");
    expect(config.connections.bulk.wsUrl).toBe("wss://exchange-ws1.bulk.trade");
    expect(config.connections.bulk.market).toBe("BTC-USD");
    expect(config.connections.bulk.nlevels).toBe(20);
    expect(config.connections.bulk.timeoutMs).toBe(30_000);
    expect(config.connections.bulk.maxLeverage).toBe(50);
    expect(config.quoteEngine.defaultTimeInForce).toBe("ALO");
    expect(config.quoteEngine.markWeight).toBe(0.25);
    expect(config.quoteEngine.bookPriceSource).toBe("vamp");
    expect(config.quoteEngine.minSpreadBps).toBe(1.7);
    expect(config.quoteEngine.sizing.budgetUsd).toBe(90_000);
    expect(config.quoteEngine.levels).toEqual([
      { halfSpreadBps: 1.1, sizeUsd: 15_000 },
      { halfSpreadBps: 1.7, sizeUsd: 15_000 },
      { halfSpreadBps: 2.6, sizeUsd: 15_000 },
      { halfSpreadBps: 4, sizeUsd: 15_000 },
      { halfSpreadBps: 6.4, sizeUsd: 15_000 },
    ]);
    expect(config.quoteEngine.strategy).toEqual({
      type: "avellaneda-stoikov",
      params: {
        gamma: 0,
        kappa: 625,
        kInv: 2,
      },
    });
    expect(config.quoteEngine.qualityGate).toEqual({
      enabled: true,
      minAverageMarkoutBps: 0,
      minSamples: 20,
      lookbackFills: 100,
      horizonsSec: [5, 30, 300],
    });
    expect(config.quoteEngine.inventoryScale).toBe(0.22);
    expect(config.quoteEngine.sizing.positionSize).toBe(1);
    expect(config.quoteEngine.sizing.bidSizeMultiplier).toBeUndefined();
    expect(config.quoteEngine.sizing.askSizeMultiplier).toBeUndefined();
    expect(config.quoteEngine.sizing.bidDistanceMultiplier).toBeUndefined();
    expect(config.quoteEngine.sizing.askDistanceMultiplier).toBeUndefined();
    expect(config.risk.maxPositionQty).toBe(1.25);
    expect(config.risk.reduceTargetQty).toBe(0.25);
    expect(config.risk.reduceTriggerQty).toBe(1.05);
    expect(config.risk.maxUnrealizedLossUsd).toBe(650);
    expect(config.risk.maxAdverseMoveBps).toBe(220);
    expect(config.bot.intervalMs).toBe(150);
    expect(config.shutdown.closePositionPolicy).toBe("always");
  });

  test("loads Bulk beta config as the default live config before mainnet launch", async () => {
    const previousMode = Bun.env.MODE;
    Bun.env.MODE = "live";
    try {
      const config = await ConfigLoader.load({ configPath: DEFAULT_CONFIG_PATH });

      expect(DEFAULT_BULK_BETA_CONFIG_PATH).toBe("config/config.bulk.beta.yml");
      expect(DEFAULT_CONFIG_PATH).toBe(DEFAULT_BULK_BETA_CONFIG_PATH);
      expect(config.mode).toBe("live");
      expect(config.venue).toBe("bulk");
      if (config.venue !== "bulk") {
        throw new Error("Expected bulk config");
      }
      expect(config.connections.bulk.environment).toBe("beta");
      expect(config.quoteEngine.sizing.budgetUsd).toBe(90_000);
      expect(config.quoteEngine.bookPriceSource).toBe("vamp");
      expect(config.quoteEngine.strategy.type).toBe("avellaneda-stoikov");
      expect(config.quoteEngine.levels).toHaveLength(5);
    } finally {
      if (previousMode === undefined) {
        delete Bun.env.MODE;
      } else {
        Bun.env.MODE = previousMode;
      }
    }
  });

  test("rejects legacy Bulk beta leaderboard strategy config", async () => {
    const configFile = Bun.file("config/config.bulk-leaderboard-test.yml");
    await Bun.write(
      configFile,
      `
mode: paper
venue: bulk

connections:
  bulk:
    wsUrl: wss://api.bulk.trade/ws
    httpUrl: https://api.bulk.trade
    market: BTC-USD
    environment: beta

quoteEngine:
  markWeight: 0.5
  inventoryScale: 0.08
  timeHorizonSec: 10
  slideMarginThreshold: 0.06
  defaultTimeInForce: GTC
  sizing:
    positionSize: 1
  strategy:
    type: bulk-beta-leaderboard
    params:
      baseHalfSpreadBps: 2.5
      minHalfSpreadBps: 1.2
      maxHalfSpreadBps: 8
      volatilitySpreadMultiplier: 1.5
      inventorySoftLimitQty: 0.08
      inventoryHardLimitQty: 0.18
      sameSideSizeMultiplierAtSoft: 0.25
      reduceSideSizeMultiplierAtSoft: 1.8

risk:
  imrBuffer: 0.06
  mmrBuffer: 0.03
  maxPositionQty: 0.85

bot:
  intervalMs: 1000

backtest:
  market: BTC-USD
  timeframe: 1m
  from: "2026-05-06"
  to: "2026-05-07"
`,
    );

    try {
      await ConfigLoader.load({
        configPath: "config/config.bulk-leaderboard-test.yml",
      }).then(
        () => {
          throw new Error("Expected legacy strategy config to reject");
        },
        (error) => {
          expect((error as Error).message).toContain("Config validation failed");
        },
      );
    } finally {
      await configFile.delete();
    }
  });

  test("rejects legacy ladder market making strategy config", async () => {
    const configFile = Bun.file("config/config.ladder-test.yml");
    await Bun.write(
      configFile,
      `
mode: paper
venue: bulk

connections:
  bulk:
    wsUrl: wss://api.bulk.trade/ws
    httpUrl: https://api.bulk.trade
    market: BTC-USD
    environment: beta

quoteEngine:
  markWeight: 0.5
  inventoryScale: 0.08
  timeHorizonSec: 10
  slideMarginThreshold: 0.06
  defaultTimeInForce: GTC
  sizing:
    positionSize: 1
  strategy:
    type: ladder-market-making
    params:
      baseHalfSpreadBps: 2.5
      minHalfSpreadBps: 1.2
      maxHalfSpreadBps: 8
      volatilitySpreadMultiplier: 1.5
      inventorySoftLimitQty: 0.08
      inventoryHardLimitQty: 0.18
      sameSideSizeMultiplierAtSoft: 0.25
      reduceSideSizeMultiplierAtSoft: 1.8

risk:
  imrBuffer: 0.06
  mmrBuffer: 0.03
  maxPositionQty: 0.85

bot:
  intervalMs: 1000

backtest:
  market: BTC-USD
  timeframe: 1m
  from: "2026-05-06"
  to: "2026-05-07"
`,
    );

    try {
      await ConfigLoader.load({
        configPath: "config/config.ladder-test.yml",
      }).then(
        () => {
          throw new Error("Expected legacy strategy config to reject");
        },
        (error) => {
          expect((error as Error).message).toContain("Config validation failed");
        },
      );
    } finally {
      await configFile.delete();
    }
  });

  test("loads committed Bulk mainnet config as conservative real-capital settings", async () => {
    const config = await ConfigLoader.load({ configPath: "config/config.bulk.mainnet.yml" });

    expect(config.venue).toBe("bulk");
    if (config.venue !== "bulk") {
      throw new Error("Expected bulk config");
    }
    expect(config.connections.bulk.environment).toBe("mainnet");
    expect(config.quoteEngine.minSpreadBps).toBe(8);
    expect(config.quoteEngine.defaultTimeInForce).toBe("ALO");
    expect(config.quoteEngine.sizing.positionSize).toBe(0.01);
    expect(config.quoteEngine.sizing.budgetUsd).toBe(100);
    expect(config.risk.maxPositionQty).toBe(0.05);
  });

  test("loads bulk config without URL or account env overrides", async () => {
    const configFile = Bun.file("config/config.bulk-test.yml");
    await Bun.write(
      configFile,
      `
mode: paper
venue: bulk

connections:
  bulk:
    wsUrl: wss://api.bulk.trade/ws
    httpUrl: https://api.bulk.trade
    market: ETH-USD
    nlevels: 20

quoteEngine:
  markWeight: 0.6
  inventoryScale: 0.05
  timeHorizonSec: 30
  slideMarginThreshold: 0.12
  defaultTimeInForce: GTC
  sizing:
    positionSize: 0.01
    budgetUsd: 100
  strategy:
    type: avellaneda-stoikov
    params:
      gamma: 0.02
      kappa: 1.5
      kInv: 0.3

risk:
  imrBuffer: 0.15
  mmrBuffer: 0.08
  maxPositionQty: 0.05

bot:
  intervalMs: 1000

paper:
  touchFillRatio: 0.5

backtest:
  market: ETH
  timeframe: 1h
  from: "2024-01-01"
  to: "2024-01-07"
`,
    );
    const previousPrivateKey = Bun.env.BULK_PRIVATE_KEY;
    const previousHttpUrl = Bun.env.BULK_HTTP_URL;
    Bun.env.BULK_PRIVATE_KEY = "bulk-secret";
    Bun.env.BULK_HTTP_URL = "https://ignored.example";

    try {
      const config = await ConfigLoader.load({ configPath: "config/config.bulk-test.yml" });

      expect(config.venue).toBe("bulk");
      if (config.venue !== "bulk") {
        throw new Error("Expected bulk config");
      }
      expect(config.connections.bulk.httpUrl).toBe("https://api.bulk.trade");
      expect(config.connections.bulk.wsUrl).toBe("wss://api.bulk.trade/ws");
      expect(config.connections.bulk.market).toBe("ETH-USD");
      expect(config.connections.bulk.nlevels).toBe(20);
      expect(config.connections.bulk.privateKey).toBeDefined();
      expect(config.quoteEngine.defaultTimeInForce).toBe("GTC");
      expect(config.quoteEngine.bookPriceSource).toBe("micro");
    } finally {
      if (previousPrivateKey === undefined) {
        delete Bun.env.BULK_PRIVATE_KEY;
      } else {
        Bun.env.BULK_PRIVATE_KEY = previousPrivateKey;
      }
      if (previousHttpUrl === undefined) {
        delete Bun.env.BULK_HTTP_URL;
      } else {
        Bun.env.BULK_HTTP_URL = previousHttpUrl;
      }
      await configFile.delete();
    }
  });
});
