import { describe, expect, test } from "bun:test";

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

describe("DIContainer Bulk venue", () => {
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
    (internals.orderGateway as BulkOrderGateway).dispose();
  });

  test("rejects bulk backtest explicitly", async () => {
    expect(new DIContainer(config("backtest")).buildBot()).rejects.toThrow(
      "Bulk venue does not support backtest mode",
    );
  });
});
