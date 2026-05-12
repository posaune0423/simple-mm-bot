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
    expect(packageJson.scripts?.["test:e2e:paper"]).toBe("bun test tests/e2e");
    expect(packageJson.scripts?.["test:coverage"]).toBe(
      "bun test --coverage tests/unit tests/integration && bun run scripts/generateCoverageSummary.ts",
    );
    expect(existsSync("tests/unit")).toBe(true);
    expect(existsSync("tests/integration")).toBe(true);
    expect(existsSync("tests/e2e")).toBe(true);
    expect(bunfig).toContain('coverageReporter = ["text", "lcov"]');
    expect(bunfig).toContain('coverageDir = "docs/coverage"');
  });

  test("keeps start explicit for live and dev commands for paper and backtest", async () => {
    const packageJson = (await Bun.file("package.json").json()) as PackageJson;

    expect(packageJson.scripts?.start).toBe(
      "CONFIG_PATH=config/config.bulk.beta.yml MODE=live bun run src/main.ts",
    );
    expect(packageJson.scripts?.["start:live"]).toBeUndefined();
    expect(packageJson.scripts?.["start:paper"]).toBeUndefined();
    expect(packageJson.scripts?.["start:backtest"]).toBeUndefined();
    expect(packageJson.scripts?.["dev:paper"]).toBe("MODE=paper bun run src/main.ts");
    expect(packageJson.scripts?.["dev:backtest"]).toBe(
      "CONFIG_PATH=config/config.backtest.yml MODE=backtest bun run src/main.ts",
    );
    expect(packageJson.scripts?.["metrics:evaluate"]).toBe("bun run scripts/evaluateLiveRun.ts");
    expect(packageJson.scripts?.["metrics:tune"]).toBe("bun run scripts/tuneBulkConfig.ts");
    expect(packageJson.scripts?.["metrics:issues"]).toBe("bun run scripts/createDesignIssues.ts");
    expect(packageJson.scripts?.["metrics:report"]).toBe(
      "bun run scripts/generateMetricsReport.ts",
    );
    expect(packageJson.scripts?.["artifacts:compact-db"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:evaluate"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:tune"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:issues"]).toBeUndefined();
    expect(packageJson.scripts?.["telemetry:report"]).toBeUndefined();
  });

  test("uses the Bulk beta config as the only default live preset before mainnet launch", async () => {
    const dockerfile = await Bun.file("Dockerfile").text();

    expect(existsSync("config/config.bulk.beta.yml")).toBe(true);
    expect(existsSync("config/config.bulk.mainnet.yml")).toBe(true);
    expect(existsSync("config/config.bulk.yml")).toBe(false);
    expect(existsSync("config/config.yml")).toBe(false);
    expect(dockerfile).toContain("ENV MODE=live");
    expect(dockerfile).toContain("ENV CONFIG_PATH=config/config.bulk.beta.yml");
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
