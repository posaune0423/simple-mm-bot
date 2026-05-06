import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

import { ConfigLoader } from "../src/config.ts";
import {
  DEFAULT_BULK_BETA_CONFIG_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_SQLITE_DB_PATH,
} from "../src/runtimePaths.ts";

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
    expect(config.connections.bulk.maxLeverage).toBe(25);
    expect(config.quoteEngine.defaultTimeInForce).toBe("GTC");
    expect(config.quoteEngine.minSpreadBps).toBe(16);
    expect(config.quoteEngine.levels).toEqual([
      { halfSpreadBps: 8, sizeUsd: 9400 },
      { halfSpreadBps: 15, sizeUsd: 18800 },
      { halfSpreadBps: 30, sizeUsd: 31300 },
      { halfSpreadBps: 60, sizeUsd: 50000 },
    ]);
    expect(config.quoteEngine.strategy.params).toEqual({
      gamma: 0,
      kappa: 625,
      kInv: 2,
    });
    expect(config.quoteEngine.inventoryScale).toBe(0.2);
    expect(config.quoteEngine.sizing.positionSize).toBe(1.25);
    expect(config.quoteEngine.sizing.budgetUsd).toBe(50000);
    expect(config.risk.maxPositionQty).toBe(0.85);
    expect(config.bot.intervalMs).toBe(1000);
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
      expect(config.quoteEngine.sizing.budgetUsd).toBe(50000);
    } finally {
      if (previousMode === undefined) {
        delete Bun.env.MODE;
      } else {
        Bun.env.MODE = previousMode;
      }
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
