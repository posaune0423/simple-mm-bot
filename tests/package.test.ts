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

    expect(packageJson.scripts?.start).toBe("MODE=live bun run src/main.ts");
    expect(packageJson.scripts?.["start:live"]).toBeUndefined();
    expect(packageJson.scripts?.["start:paper"]).toBeUndefined();
    expect(packageJson.scripts?.["start:backtest"]).toBeUndefined();
    expect(packageJson.scripts?.["dev:paper"]).toBe("MODE=paper bun run src/main.ts");
    expect(packageJson.scripts?.["dev:backtest"]).toBe(
      "CONFIG_PATH=config/config.backtest.yml MODE=backtest bun run src/main.ts",
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
