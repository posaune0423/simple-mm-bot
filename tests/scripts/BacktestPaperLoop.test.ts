import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveBacktestPaperLoopOptions } from "../../scripts/backtestPaperLoop.ts";

describe("resolveBacktestPaperLoopOptions", () => {
  test("defaults to the shared SQLite DB and data-local run results", () => {
    const previousDbPath = Bun.env.DB_PATH;
    delete Bun.env.DB_PATH;

    try {
      const options = resolveBacktestPaperLoopOptions([], 1_771_459_200_000);

      expect(options.dbPath).toBe("data/mm.db");
      expect(options.outputDir).toBe(join("data/strategy-runs", "20260219-000000-loop"));
      expect(options.dbPath).not.toContain("loop.db");
    } finally {
      restoreEnv("DB_PATH", previousDbPath);
    }
  });

  test("allows explicit DB_PATH and --db override while keeping run results separate", () => {
    const previousDbPath = Bun.env.DB_PATH;
    Bun.env.DB_PATH = "tmp/env.db";

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
      restoreEnv("DB_PATH", previousDbPath);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env[key];
    return;
  }
  Bun.env[key] = value;
}
