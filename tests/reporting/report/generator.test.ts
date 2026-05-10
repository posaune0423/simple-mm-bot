import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { generateReport } from "../../../src/lib/reporting/report/generator.ts";
import { sampleFills } from "../fixtures.ts";

describe("generateReport", () => {
  const tempDir = join(process.cwd(), "tmp-tests-report");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("writes latest.md, history snapshot, and per-period chart svgs", async () => {
    const fills = sampleFills();
    const now = Date.UTC(2026, 4, 6, 12, 0, 0);
    const fetchFills = async (): Promise<typeof fills> => fills;

    const result = await generateReport({
      fetchFills,
      now,
      mode: "live",
      venue: "hyperliquid",
      outputDir: tempDir,
      periods: [
        { key: "24h", label: "24h", durationMs: 24 * 60 * 60 * 1000 },
        { key: "7d", label: "7d", durationMs: 7 * 24 * 60 * 60 * 1000 },
      ],
    });

    expect(result.latestMd).toBe(join(tempDir, "latest.md"));
    expect(result.historyMd).toBe(join(tempDir, "2026-05-06", "report.md"));
    expect(result.chartFiles.length).toBeGreaterThan(15);

    const latest = await readFile(result.latestMd, "utf8");
    expect(latest).toContain("Bot Performance Report");
    expect(latest).toContain("![Equity Curve (24h)]");
    expect(latest).toContain("![Rolling Sharpe (7d)]");
    expect(latest).toContain("./2026-05-06/charts/24h/equity.svg");

    const charts24h = await readdir(join(tempDir, "2026-05-06", "charts", "24h"));
    expect(charts24h).toContain("equity.svg");
    expect(charts24h).toContain("price-vs-mid.svg");
    const charts7d = await readdir(join(tempDir, "2026-05-06", "charts", "7d"));
    expect(charts7d).toContain("rolling-sharpe.svg");

    const equitySvg = await readFile(
      join(tempDir, "2026-05-06", "charts", "24h", "equity.svg"),
      "utf8",
    );
    expect(equitySvg.startsWith("<svg")).toBe(true);

    const historyMd = await readFile(result.historyMd, "utf8");
    expect(historyMd).toContain("./charts/24h/equity.svg");
  });
});
