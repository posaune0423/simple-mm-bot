import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveBacktestPaperLoopOptions } from "../../../scripts/backtestPaperLoop.ts";

describe("resolveBacktestPaperLoopOptions", () => {
  test("defaults to the shared SQLite DB and data-local run results", () => {
    const previousDatabaseUrl = Bun.env.DATABASE_URL;
    delete Bun.env.DATABASE_URL;

    try {
      const options = resolveBacktestPaperLoopOptions([], 1_771_459_200_000);

      expect(options.dbPath).toBe("data/mm.db");
      expect(options.outputDir).toBe(join("data/strategy-runs", "20260219-000000-loop"));
      expect(options.configPath).toBe("config/bulk/beta.yml");
      expect(options.dbPath).not.toContain("loop.db");
    } finally {
      restoreEnv("DATABASE_URL", previousDatabaseUrl);
    }
  });

  test("allows explicit DATABASE_URL and --db override while keeping run results separate", () => {
    const previousDatabaseUrl = Bun.env.DATABASE_URL;
    Bun.env.DATABASE_URL = "file:tmp/env.db";

    try {
      const fromEnv = resolveBacktestPaperLoopOptions(["--label", "sweep-a"], 1_771_459_200_000);
      const fromFlag = resolveBacktestPaperLoopOptions(
        ["--db", "tmp/flag.db", "--output-dir", "tmp/run"],
        1_771_459_200_000,
      );

      expect(fromEnv.dbPath).toBe("tmp/env.db");
      expect(fromEnv.outputDir).toBe(join("data/strategy-runs", "20260219-000000-sweep-a"));
      expect(fromFlag.dbPath).toBe("tmp/flag.db");
      expect(fromFlag.outputDir).toBe("tmp/run");
    } finally {
      restoreEnv("DATABASE_URL", previousDatabaseUrl);
    }
  });

  test("uses one venue preset for both backtest and paper phases", () => {
    const options = resolveBacktestPaperLoopOptions(
      ["--config", "config/bulk/mainnet.yml"],
      1_771_459_200_000,
    );

    expect(options.configPath).toBe("config/bulk/mainnet.yml");
    expect("backtestConfigPath" in options).toBe(false);
    expect("paperConfigPath" in options).toBe(false);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env[key];
    return;
  }
  Bun.env[key] = value;
}
