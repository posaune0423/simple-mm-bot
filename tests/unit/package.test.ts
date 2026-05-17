import { existsSync, readdirSync, statSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { toKeychainMarketOrder } from "../../node_modules/bulk-ts-sdk/esm/builders/orders.js";
import { KeychainSigner } from "../../node_modules/bulk-ts-sdk/esm/signing/keychain_signer.js";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const dummyPrivateKey = "J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1";

describe("package scripts", () => {
  test("keeps tests split by unit, integration, e2e, and coverage docs", async () => {
    const packageJson = (await Bun.file("package.json").json()) as PackageJson;
    const bunfig = await Bun.file("bunfig.toml").text();

    expect(packageJson.scripts?.test).toBe("bun run test:unit && bun run test:integration");
    expect(packageJson.scripts?.["test:unit"]).toBe("bun test tests/unit");
    expect(packageJson.scripts?.["test:integration"]).toBe("bun test tests/integration");
    expect(packageJson.scripts?.["test:e2e:paper"]).toBeUndefined();
    expect(packageJson.scripts?.["test:coverage"]).toBe(
      "bun test --coverage tests/unit tests/integration && bun run scripts/generateCoverageSummary.ts",
    );
    expect(existsSync("tests/unit")).toBe(true);
    expect(existsSync("tests/integration")).toBe(true);
    expect(existsSync("tests/e2e")).toBe(false);
    expect(bunfig).toContain('coverageReporter = ["text", "lcov"]');
    expect(bunfig).toContain('coverageDir = "docs/coverage"');
  });

  test("keeps start explicit for live and dev commands for paper and backtest", async () => {
    const packageJson = (await Bun.file("package.json").json()) as PackageJson;

    expect(packageJson.scripts?.start).toBe(
      "CONFIG_PATH= CONFIG_VENUE=bulk CONFIG_PRESET=beta MODE=live bun run src/main.ts",
    );
    expect(packageJson.scripts?.["start:live"]).toBeUndefined();
    expect(packageJson.scripts?.["start:paper"]).toBeUndefined();
    expect(packageJson.scripts?.["start:backtest"]).toBeUndefined();
    expect(packageJson.scripts?.["dev:paper"]).toBe(
      "CONFIG_PATH= CONFIG_VENUE=bulk CONFIG_PRESET=beta MODE=paper bun run src/main.ts",
    );
    expect(packageJson.scripts?.["dev:backtest"]).toBe(
      "CONFIG_PATH= CONFIG_VENUE=bulk CONFIG_PRESET=beta MODE=backtest bun run src/main.ts",
    );
    expect(packageJson.scripts?.["metrics:evaluate"]).toBeUndefined();
    expect(packageJson.scripts?.["metrics:funding"]).toBeUndefined();
    expect(packageJson.scripts?.["loop:backtest-paper"]).toBeUndefined();
    expect(packageJson.scripts?.["report:generate"]).toBeUndefined();
    expect(packageJson.scripts?.["metrics:tune"]).toBe("bun run scripts/tuneBulkConfig.ts");
    expect(packageJson.scripts?.["metrics:issues"]).toBe("bun run scripts/createDesignIssues.ts");
    expect(packageJson.scripts?.["metrics:report"]).toBe(
      "bun run scripts/generateMetricsReport.ts",
    );
    expect(packageJson.scripts?.["record:market-data"]).toBe(
      "bun run src/workers/marketDataRecorder.ts",
    );
    expect(packageJson.scripts?.["record:bulk"]).toBe(
      "RECORDER_VENUE=bulk bun run src/workers/marketDataRecorder.ts",
    );
    expect(packageJson.scripts?.["bulk:register-agent-wallet"]).toBe(
      "bun run scripts/registerBulkAgentWallet.ts",
    );
    expect(packageJson.scripts?.["artifacts:compact-db"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:evaluate"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:tune"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:issues"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:report"]).toBeUndefined();
  });

  test("uses venue-scoped Bulk presets and no mode-scoped config files", async () => {
    const dockerfile = await Bun.file("Dockerfile").text();

    expect(existsSync("config/bulk/beta.yml")).toBe(true);
    expect(existsSync("config/bulk/mainnet.yml")).toBe(true);
    expect(existsSync("config/config.paper.yml")).toBe(false);
    expect(existsSync("config/config.backtest.yml")).toBe(false);
    expect(existsSync("config/config.bulk.beta.yml")).toBe(false);
    expect(existsSync("config/config.bulk.mainnet.yml")).toBe(false);
    expect(existsSync("config/config.bulk.yml")).toBe(false);
    expect(existsSync("config/config.yml")).toBe(false);
    expect(dockerfile).toContain("ENV MODE=live");
    expect(dockerfile).toContain("ENV CONFIG_VENUE=bulk");
    expect(dockerfile).toContain("ENV CONFIG_PRESET=beta");
    expect(dockerfile).not.toContain("ENV CONFIG_PATH=");
    expect(dockerfile).not.toContain("config/config.yml");
  });

  test("keeps agent helper logic in scripts and persistence contracts in infrastructure", async () => {
    const drizzleConfig = await Bun.file("drizzle.config.ts").text();

    expect(existsSync("src/ops")).toBe(false);
    expect(existsSync("src/telemetry")).toBe(false);
    expect(existsSync("src/reporting")).toBe(false);
    expect(existsSync("src/lib/reporting")).toBe(true);
    expect(existsSync("src/runtimePaths.ts")).toBe(false);
    expect(existsSync("src/constants.ts")).toBe(false);
    expect(existsSync("tests/ops")).toBe(false);
    expect(existsSync("scripts/lib/paths.ts")).toBe(true);
    expect(drizzleConfig).not.toContain("./src/constants.ts");
    expect(existsSync("scripts/lib/MetricsEvaluation.ts")).toBe(true);
    expect(existsSync("src/application/services/MetricsRecorder.ts")).toBe(true);
    expect(existsSync("src/application/TelemetryRecorder.ts")).toBe(false);
    expect(existsSync("src/infrastructure/Telemetry.ts")).toBe(false);
    expect(existsSync("src/infrastructure/TelemetryRepository.ts")).toBe(false);
    expect(existsSync("src/infrastructure/db/sqlite/repository/SqliteTelemetryRepository.ts")).toBe(
      false,
    );
  });

  test("keeps data directory free of legacy local runtime DB artifacts", async () => {
    const disallowedDataPaths = [
      "data/mm.db",
      "data/market",
      "data/runs",
      "data/strategy-runs",
      "data/metrics",
      "data/live-logs",
      "data/tmp",
      "data/edge-discovery",
    ];

    for (const path of disallowedDataPaths) {
      expect(existsSync(path), path).toBe(false);
    }

    const scannedFiles = listFiles(["data"], ["data/timescaledb"]);
    const forbiddenTokens = [
      "bun:sqlite",
      "createSqliteClient",
      "data/mm.db",
      "file:data",
      "trade_fills",
      "orderbook_snapshots",
      "runtime_health",
    ];
    const fileTexts = await Promise.all(
      scannedFiles.map(async (file) => ({
        file,
        text: await Bun.file(file).text(),
      })),
    );
    const offenders = fileTexts
      .filter(({ text }) => forbiddenTokens.some((token) => text.includes(token)))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  test("documents TimescaleDB schema in the existing database guide format", async () => {
    const databaseDoc = await Bun.file("docs/DATABASE.md").text();

    expect(databaseDoc).toStartWith("# Database");
    expect(databaseDoc).toContain("## Database 一覧");
    expect(databaseDoc).toContain("## Folder Structure");
    expect(databaseDoc).toContain("## Market Data Table Roles");
    expect(databaseDoc).toContain("## Market Data ER 図");
    expect(databaseDoc).toContain("## Bot Execution ER 図");
    expect(databaseDoc).toContain("analytics_quote_markouts");
    expect(databaseDoc).toContain("analytics_fill_markouts");
    expect(databaseDoc).not.toContain(".sqlite");
    expect(databaseDoc).not.toContain("data/mm.db");
    expect(databaseDoc).not.toContain("DuckDB");
  });
});

describe("validation dependencies", () => {
  test("uses valibot as the only direct runtime validation dependency", async () => {
    const packageJson = (await Bun.file("package.json").json()) as PackageJson;

    expect(packageJson.dependencies?.valibot).toBeDefined();
    expect(packageJson.dependencies?.zod).toBeUndefined();
    expect(packageJson.devDependencies?.zod).toBeUndefined();
  });

  test("does not import zod from source or tests", async () => {
    const sourceFiles = listTypeScriptFiles(["src", "tests"]);
    const zodImports = (
      await Promise.all(
        sourceFiles.map(async (file) => ({
          file,
          text: await Bun.file(file).text(),
        })),
      )
    ).filter(({ text }) => /\bfrom\s+["']zod["']/.test(text));

    expect(zodImports.map(({ file }) => file)).toEqual([]);
  });
});

describe("bulk-ts-sdk package", () => {
  test("signs reduce-only market orders as Bulk API market actions", async () => {
    const signer = KeychainSigner.fromPrivateKey(dummyPrivateKey);
    const signed = signer.sign(
      toKeychainMarketOrder({
        symbol: "BTC-USD",
        side: "sell",
        size: 0.1,
        reduceOnly: true,
      }),
    );

    expect(signed.actions).toEqual([
      {
        m: {
          c: "BTC-USD",
          b: false,
          sz: 0.1,
          r: true,
          i: false,
        },
      },
    ]);
  });
});

function listTypeScriptFiles(paths: string[]): string[] {
  return paths.flatMap((path) => {
    if (!existsSync(path)) {
      return [];
    }
    if (statSync(path).isFile()) {
      return path.endsWith(".ts") ? [path] : [];
    }
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      listTypeScriptFiles([`${path}/${entry.name}`]),
    );
  });
}

function listFiles(paths: string[], ignoredPrefixes: string[] = []): string[] {
  return paths.flatMap((path) => {
    if (!existsSync(path)) {
      return [];
    }
    if (ignoredPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return [];
    }
    if (statSync(path).isFile()) {
      return [path];
    }
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      listFiles([`${path}/${entry.name}`], ignoredPrefixes),
    );
  });
}
