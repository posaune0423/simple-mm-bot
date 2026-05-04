import { describe, expect, test } from "bun:test";

import { ConfigLoader } from "../src/config.ts";

describe("ConfigLoader", () => {
  test("loads quote sizing from committed config", async () => {
    const config = await ConfigLoader.load({ configPath: "config/config.paper.yml" });

    expect(config.quoteEngine.sizing.positionSize).toBe(0.01);
    expect(config.quoteEngine.sizing.budgetUsd).toBe(100);
  });
});
