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

  test("value object directory only contains types with domain invariants or behavior", () => {
    const nonValueObjectFiles = [
      "src/domain/value-objects/Brand.ts",
      "src/domain/value-objects/MarketId.ts",
      "src/domain/value-objects/ModelQuote.ts",
      "src/domain/value-objects/QuoteEngineInput.ts",
      "src/domain/value-objects/QuoteModelInput.ts",
      "src/domain/value-objects/SideMarkoutFeedback.ts",
      "src/domain/value-objects/StrategyDecision.ts",
    ];

    for (const file of nonValueObjectFiles) {
      expect(existsSync(join(root, file)), file).toBe(false);
    }

    for (const file of [
      "src/domain/value-objects/BasisPoints.ts",
      "src/domain/value-objects/Price.ts",
      "src/domain/value-objects/Quantity.ts",
    ]) {
      expect(readFileSync(join(root, file), "utf8")).not.toContain("./Brand");
    }
  });

  test("strategy directory keeps strategy contracts and strategy ADTs together", () => {
    const strategy = readFileSync(join(root, "src/domain/strategies/Strategy.ts"), "utf8");

    expect(strategy).toContain("export type StrategyDecision");
    expect(strategy).toContain("export const StrategyDecision");
    expect(strategy).toContain("export interface SideMarkoutFeedback");
    expect(existsSync(join(root, "src/domain/decisions"))).toBe(false);
  });

  test("domain does not keep ambiguous market or quote quality buckets", () => {
    expect(existsSync(join(root, "src/domain/market"))).toBe(false);
    expect(existsSync(join(root, "src/domain/value-objects/QuoteQuality.ts"))).toBe(false);
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

  test("domain errors stay in domain and generic result helpers stay semantic-free", () => {
    const domainFiles = [
      "src/domain/errors/DomainError.ts",
      "src/domain/quote-models/QuoteModel.ts",
      "src/domain/services/QuoteEngine.ts",
      "src/domain/strategies/Strategy.ts",
      "src/domain/value-objects/Price.ts",
      "src/domain/value-objects/Quantity.ts",
      "src/domain/value-objects/BasisPoints.ts",
      "src/domain/value-objects/Quote.ts",
      "src/domain/value-objects/QuoteLeg.ts",
      "src/domain/value-objects/OrderIntent.ts",
      "src/domain/value-objects/PositionSnapshot.ts",
    ];

    for (const file of domainFiles) {
      expect(readFileSync(join(root, file), "utf8"), file).not.toContain("../utils/errors");
      expect(readFileSync(join(root, file), "utf8"), file).not.toContain("../../utils/errors");
    }

    const result = readFileSync(join(root, "src/utils/result.ts"), "utf8");
    expect(result).not.toContain("AppResult");
    expect(result).not.toContain("AppResultAsync");
    expect(result).toContain("export function combine");
    expect(result).toContain("export function sequence");
    expect(result).toContain("export function combineProperties");
  });

  test("error classes are defined at their owning layer boundaries", () => {
    expect(existsSync(join(root, "src/utils/cliError.ts"))).toBe(false);
    expect(existsSync(join(root, "src/application/errors/ApplicationError.ts"))).toBe(true);
    expect(existsSync(join(root, "scripts/errors/ScriptError.ts"))).toBe(true);

    for (const file of [
      "scripts/backtestPaperLoop.ts",
      "scripts/createDesignIssues.ts",
      "scripts/evaluateLiveRun.ts",
      "scripts/generateMetricsReport.ts",
      "scripts/generateReport.ts",
      "scripts/tuneBulkConfig.ts",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toContain("CliError");
      expect(source, file).toContain("ScriptError");
    }

    const orderIntentBuilder = readFileSync(
      join(root, "src/application/services/OrderIntentBuilder.ts"),
      "utf8",
    );
    const orderReconciler = readFileSync(
      join(root, "src/application/services/OrderReconciler.ts"),
      "utf8",
    );

    expect(orderIntentBuilder).toContain("ApplicationError");
    expect(orderReconciler).toContain("ApplicationError");
  });
});
