import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { DIContainer } from "../../src/application/di.ts";
import { ConfigLoader } from "../../src/config.ts";
import { createSqliteClient } from "../../src/infrastructure/db/sqlite/client.ts";

function latestRunPerformance(dbPath: string, mode: string) {
  const client = createSqliteClient(dbPath);
  try {
    return client.sqlite
      .query<{ venue: string; fill_rate: number }, [string]>(
        `
          SELECT r.venue, COALESCE(p.fill_rate, 0) AS fill_rate
          FROM trading_runs r
          LEFT JOIN v_run_performance p ON p.run_id = r.id
          WHERE r.mode = ?
          ORDER BY r.started_at DESC
          LIMIT 1
        `,
      )
      .get(mode);
  } finally {
    client.sqlite.close();
  }
}

describe("backtest and paper smoke", () => {
  const tempDir = join(process.cwd(), "tmp-e2e");

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("runs a short backtest session against public Bulk historical data", async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const previousMode = Bun.env.MODE;
    Bun.env.MODE = "backtest";
    const config = await ConfigLoader.load({ configPath: "config/config.backtest.yml" });
    config.backtest.from = start.toISOString();
    config.backtest.to = end.toISOString();
    const previousDbPath = Bun.env.DB_PATH;
    const dbPath = join(tempDir, "backtest.db");
    Bun.env.DB_PATH = dbPath;
    try {
      const bot = await new DIContainer(config).buildBot();
      await bot.start(4);
      const performance = latestRunPerformance(dbPath, "backtest");

      expect(performance?.venue).toBe("bulk");
      expect(performance?.fill_rate).toBeGreaterThanOrEqual(0);
    } finally {
      restoreEnv("DB_PATH", previousDbPath);
      restoreEnv("MODE", previousMode);
    }
  }, 30_000);

  test("runs a short paper session against the public live feed", async () => {
    const previousMode = Bun.env.MODE;
    Bun.env.MODE = "paper";
    const config = await ConfigLoader.load({ configPath: "config/config.paper.yml" });
    const previousDbPath = Bun.env.DB_PATH;
    const dbPath = join(tempDir, "paper.db");
    Bun.env.DB_PATH = dbPath;
    try {
      const bot = await new DIContainer(config).buildBot();
      await bot.start(2);
      const performance = latestRunPerformance(dbPath, "paper");

      expect(performance?.venue).toBe("bulk");
      expect(performance?.fill_rate).toBeGreaterThanOrEqual(0);
    } finally {
      restoreEnv("DB_PATH", previousDbPath);
      restoreEnv("MODE", previousMode);
    }
  }, 30_000);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env[key];
    return;
  }
  Bun.env[key] = value;
}
