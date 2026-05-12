import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = process.cwd();

const removedLegacyFiles = [
  "src/application/QuotingStrategyFactory.ts",
  "src/application/usecases/RefreshQuotesUseCase.ts",
  "src/domain/QuoteControls.ts",
  "src/domain/QuoteControlPolicy.ts",
  "src/domain/QuoteEngine.ts",
  "src/domain/FairPriceCalculator.ts",
  "src/domain/VolatilityEstimator.ts",
  "src/domain/MarketContext.ts",
  "src/domain/MarketContextBuilder.ts",
  "src/domain/QuoteQuality.ts",
  "src/domain/strategy/IQuotingStrategy.ts",
  "src/domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts",
  "src/domain/decisions/StrategyDecision.ts",
  "src/domain/decisions/RiskDecision.ts",
  "src/domain/strategies/StrategyDecision.ts",
  "src/application/OrderManager.ts",
  "src/application/services/OrderManagerReconciler.ts",
  "src/application/MetricsRecorder.ts",
  "src/application/shutdown.ts",
];

describe("refactor architecture boundaries", () => {
  test("legacy quote/strategy files are removed from active architecture", () => {
    for (const file of removedLegacyFiles) {
      expect(existsSync(join(root, file)), file).toBe(false);
    }
  });

  test("application DI uses the new quote refresh composition", () => {
    const di = readFileSync(join(root, "src/application/di.ts"), "utf8");

    expect(di).not.toContain("QuotingStrategyFactory");
    expect(di).not.toContain("RefreshQuotesUseCase");
    expect(di).toContain("QuoteRefreshService");
    expect(di).toContain("StrategyFactory");
    expect(di).toContain("OrderIntentBuilder");
    expect(di).toContain("ManagedOrderReconciler");
    expect(di).not.toContain("OrderManagerReconciler");
    expect(di).not.toContain("OrderManager");
  });

  test("strategy directory only contains strategy contracts and implementations", () => {
    expect(existsSync(join(root, "src/domain/value-objects/StrategyDecision.ts"))).toBe(true);
    expect(existsSync(join(root, "src/domain/decisions"))).toBe(false);
  });

  test("domain does not keep ambiguous market or quote quality buckets", () => {
    expect(existsSync(join(root, "src/domain/market"))).toBe(false);
    expect(existsSync(join(root, "src/domain/value-objects/QuoteQuality.ts"))).toBe(false);
    expect(existsSync(join(root, "src/domain/value-objects/SideMarkoutFeedback.ts"))).toBe(true);
  });

  test("process shutdown is handled at the main boundary", () => {
    const main = readFileSync(join(root, "src/main.ts"), "utf8");

    expect(main).not.toContain("registerShutdownHandlers");
    expect(main).not.toContain("let stopRequested");
    expect(main).toContain("SIGINT");
    expect(main).toContain("SIGTERM");
    expect(main).toContain("AbortController");
    expect(main).not.toContain("bot.stop");
  });
});
