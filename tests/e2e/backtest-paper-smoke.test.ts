import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { DIContainer } from "../../src/application/di.ts";
import { ConfigLoader } from "../../src/config.ts";

describe("backtest and paper smoke", () => {
  const tempDir = join(process.cwd(), "tmp-e2e");

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("runs a short backtest session against public Hyperliquid data", async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const config = await ConfigLoader.load({ configPath: "config/config.backtest.yml" });
    config.backtest.from = start.toISOString();
    config.backtest.to = end.toISOString();
    const previousDbPath = Bun.env.DB_PATH;
    Bun.env.DB_PATH = join(tempDir, "backtest.db");
    try {
      const bot = await new DIContainer(config).buildBot();
      const report = await bot.start(4);

      expect(report.venue).toBe("hyperliquid");
      expect(report.metrics.fillRate).toBeGreaterThanOrEqual(0);
    } finally {
      Bun.env.DB_PATH = previousDbPath;
    }
  }, 30_000);

  test("runs a short paper session against the public live feed", async () => {
    const config = await ConfigLoader.load({ configPath: "config/config.paper.yml" });
    const previousDbPath = Bun.env.DB_PATH;
    Bun.env.DB_PATH = join(tempDir, "paper.db");
    try {
      const bot = await new DIContainer(config).buildBot();
      const report = await bot.start(2);

      expect(report.venue).toBe("bulk");
      expect(report.metrics.fillRate).toBeGreaterThanOrEqual(0);
    } finally {
      Bun.env.DB_PATH = previousDbPath;
    }
  }, 30_000);
});
