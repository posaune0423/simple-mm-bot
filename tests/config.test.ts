import { describe, expect, test } from "bun:test";

import { ConfigLoader } from "../src/config.ts";

describe("ConfigLoader", () => {
  test("loads quote sizing from committed config", async () => {
    const config = await ConfigLoader.load({ configPath: "config/config.paper.yml" });

    expect(config.quoteEngine.sizing.positionSize).toBe(0.01);
    expect(config.quoteEngine.sizing.budgetUsd).toBe(100);
  });

  test("loads committed Bulk config", async () => {
    const config = await ConfigLoader.load({ configPath: "config/config.bulk.yml" });

    expect(config.venue).toBe("bulk");
    if (config.venue !== "bulk") {
      throw new Error("Expected bulk config");
    }
    expect(config.connections.bulk.httpUrl).toBe("https://exchange-api.bulk.trade/api/v1");
    expect(config.connections.bulk.wsUrl).toBe("wss://exchange-ws1.bulk.trade");
    expect(config.connections.bulk.market).toBe("ETH-USD");
    expect(config.connections.bulk.nlevels).toBe(20);
    expect(config.quoteEngine.defaultTimeInForce).toBe("GTC");
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
