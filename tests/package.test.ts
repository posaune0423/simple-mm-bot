import { existsSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { toKeychainMarketOrder } from "../node_modules/bulk-ts-sdk/esm/builders/orders.js";
import { KeychainSigner } from "../node_modules/bulk-ts-sdk/esm/signing/keychain_signer.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

const dummyPrivateKey = "J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1vPZ1J1";

describe("package scripts", () => {
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

  test("keeps agent helper logic in scripts and persistence contracts in infrastructure", () => {
    expect(existsSync("src/ops")).toBe(false);
    expect(existsSync("src/telemetry")).toBe(false);
    expect(existsSync("src/reporting")).toBe(false);
    expect(existsSync("src/lib/reporting")).toBe(true);
    expect(existsSync("src/runtimePaths.ts")).toBe(false);
    expect(existsSync("src/constants.ts")).toBe(true);
    expect(existsSync("tests/ops")).toBe(false);
    expect(existsSync("scripts/lib/MetricsEvaluation.ts")).toBe(true);
    expect(existsSync("src/application/MetricsRecorder.ts")).toBe(true);
    expect(existsSync("src/application/TelemetryRecorder.ts")).toBe(false);
    expect(existsSync("src/infrastructure/Telemetry.ts")).toBe(false);
    expect(existsSync("src/infrastructure/TelemetryRepository.ts")).toBe(false);
    expect(existsSync("src/infrastructure/db/sqlite/repository/SqliteTelemetryRepository.ts")).toBe(
      false,
    );
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
