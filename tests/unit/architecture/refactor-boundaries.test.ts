import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = process.cwd();
const sourceRoots = ["src", "scripts"];
const legacyOrderReconcilerName = ["Managed", "Order", "Reconciler"].join("");

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
  "src/domain/quote-models/AvellanedaStoikovParams.ts",
  "src/domain/decisions/StrategyDecision.ts",
  "src/domain/decisions/RiskDecision.ts",
  "src/application/OrderManager.ts",
  "src/application/services/OrderManagerReconciler.ts",
  "src/application/MetricsRecorder.ts",
  "src/application/shutdown.ts",
  "src/domain/entities/Fill.ts",
  "src/domain/entities/PerformanceMetrics.ts",
  "src/domain/entities/Position.ts",
  "src/domain/entities/Quote.ts",
  "src/domain/events/Fill.ts",
  "src/domain/orders/OrderTypes.ts",
  "src/domain/positions/Position.ts",
  "src/domain/legacy/LegacyQuote.ts",
  "src/domain/types/LegacyQuote.ts",
  "src/application/services/QuoteRefreshService.ts",
  `src/application/services/${legacyOrderReconcilerName}.ts`,
  "src/utils/transientBulk.ts",
  "src/utils/slackNotification.ts",
  "src/lib/slack/errorLevels.ts",
];

describe("refactor architecture boundaries", () => {
  test("legacy quote/strategy files are removed from active architecture", () => {
    for (const file of removedLegacyFiles) {
      expect(existsSync(join(root, file)), file).toBe(false);
    }
  });

  test("application DI uses the new quoting cycle composition", () => {
    const di = readFileSync(join(root, "src/application/di.ts"), "utf8");

    expect(di).not.toContain("QuotingStrategyFactory");
    expect(di).not.toContain("RefreshQuotesUseCase");
    expect(di).not.toContain("QuoteRefresh");
    expect(di).not.toContain("refreshQuotes");
    expect(di).toContain("QuotingCycleService");
    expect(di).toContain("quotingCycle");
    expect(di).toContain("StrategyFactory");
    expect(di).toContain("OrderIntentBuilder");
    expect(di).toContain("OrderReconciler");
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

  test("domain plain contracts are kept in types instead of pseudo-entity buckets", () => {
    expect(existsSync(join(root, "src/domain/entities"))).toBe(false);
    expect(existsSync(join(root, "src/domain/events"))).toBe(false);
    expect(existsSync(join(root, "src/domain/orders"))).toBe(false);
    expect(existsSync(join(root, "src/domain/positions"))).toBe(false);
    expect(existsSync(join(root, "src/domain/legacy"))).toBe(false);
    expect(existsSync(join(root, "src/domain/types/Fill.ts"))).toBe(true);
    expect(existsSync(join(root, "src/domain/types/Order.ts"))).toBe(true);
    expect(existsSync(join(root, "src/domain/types/Position.ts"))).toBe(true);
    expect(existsSync(join(root, "src/domain/types/QuoteMetrics.ts"))).toBe(true);
    expect(existsSync(join(root, "src/domain/types/PerformanceMetrics.ts"))).toBe(true);
  });

  test("process shutdown is handled at the main boundary", () => {
    const main = readFileSync(join(root, "src/main.ts"), "utf8");
    const shutdownSignals = readFileSync(join(root, "src/utils/shutdownSignals.ts"), "utf8");

    expect(main).not.toContain("registerShutdownHandlers");
    expect(main).not.toContain("let stopRequested");
    expect(main).toContain("installShutdownSignalHandlers");
    expect(shutdownSignals).toContain("SIGINT");
    expect(shutdownSignals).toContain("SIGTERM");
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

  test("domain calculation errors are centralized under domain errors", () => {
    const domainError = readFileSync(join(root, "src/domain/errors/DomainError.ts"), "utf8");
    expect(domainError).toContain("export abstract class QuoteModelError");
    expect(domainError).toContain("export type QuoteEngineError");
    expect(domainError).toContain("abstract class StrategyErrorBase");

    for (const file of [
      "src/domain/quote-models/QuoteModel.ts",
      "src/domain/services/QuoteEngine.ts",
      "src/domain/strategies/Strategy.ts",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toMatch(/class \w*Error\b/);
      expect(source, file).toContain("../errors/DomainError");
    }
  });

  test("funding-aware domain stays SDK-free and uses value-object quote boundaries", () => {
    const fundingModel = readFileSync(
      join(root, "src/domain/quote-models/FundingAwareQuoteModel.ts"),
      "utf8",
    );
    const fundingStrategy = readFileSync(
      join(root, "src/domain/strategies/FundingAwarePmmStrategy.ts"),
      "utf8",
    );
    const alloraCache = readFileSync(
      join(root, "src/infrastructure/allora/AlloraPredictionCache.ts"),
      "utf8",
    );

    for (const [file, source] of [
      ["FundingAwareQuoteModel.ts", fundingModel],
      ["FundingAwarePmmStrategy.ts", fundingStrategy],
    ] as const) {
      expect(source, file).not.toContain("@alloralabs/allora-sdk");
      expect(source, file).not.toContain("AlloraAPIClient");
      expect(source, file).not.toContain("src/infrastructure");
      expect(source, file).not.toContain("../../infrastructure");
    }

    expect(fundingModel).toContain("Price.unsafe");
    expect(fundingModel).toContain("BasisPoints.unsafe");
    expect(fundingModel).toContain("ModelQuote.create");
    expect(fundingStrategy).toContain("AlphaDriftProvider");
    expect(alloraCache).toContain("@alloralabs/allora-sdk");
  });

  test("error classes are defined at their owning layer boundaries", () => {
    expect(existsSync(join(root, "src/utils/cliError.ts"))).toBe(false);
    expect(existsSync(join(root, "src/application/errors/ApplicationError.ts"))).toBe(true);
    expect(existsSync(join(root, "scripts/errors/ScriptError.ts"))).toBe(true);

    for (const file of [
      "scripts/createDesignIssues.ts",
      "scripts/generateMetricsReport.ts",
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

  test("order reconciliation is a single application service boundary", () => {
    const orderReconciler = readFileSync(
      join(root, "src/application/services/OrderReconciler.ts"),
      "utf8",
    );

    expect(orderReconciler).toContain("export class OrderReconciler");
    expect(orderReconciler).toContain("export type ReconcileResult");
    expect(orderReconciler).toContain("export class OrderReconcileFailedError");

    for (const sourceRoot of sourceRoots) {
      for (const file of tsFiles(join(root, sourceRoot))) {
        const relative = file.replace(`${root}/`, "");
        const source = readFileSync(file, "utf8");
        expect(source, relative).not.toContain(`services/${legacyOrderReconcilerName}`);
        expect(source, relative).not.toContain(`./${legacyOrderReconcilerName}`);
        expect(source, relative).not.toContain(legacyOrderReconcilerName);
      }
    }
  });

  test("closed multi-way branches use ts-pattern instead of manual switches", () => {
    const filesWithSwitch = sourceRoots
      .flatMap((sourceRoot) => tsFiles(join(root, sourceRoot)))
      .filter((file) => /\bswitch\s*\(/.test(readFileSync(file, "utf8")));

    expect(filesWithSwitch.map((file) => file.replace(`${root}/`, ""))).toEqual([]);

    for (const file of [
      "src/domain/strategies/Strategy.ts",
      "src/application/di.ts",
      "src/application/services/MetricsRecorder.ts",
      "src/adapters/bulk/BulkOrderGateway.ts",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).toContain("ts-pattern");
      expect(source, file).toContain("match(");
    }
  });

  test("database runtime is TimescaleDB and Postgres only", () => {
    expect(existsSync(join(root, "src/infrastructure/db/sqlite"))).toBe(false);
    expect(existsSync(join(root, "src/lib/reporting/queries/MetricsFactQuery.ts"))).toBe(false);

    const forbidden = [
      "bun:sqlite",
      "drizzle-orm/bun-sqlite",
      "drizzle-orm/sqlite-core",
      "SqliteMetricsRepository",
      "SqliteOhlcvRepository",
      "createSqliteClient",
      "resolveSqliteDatabasePath",
      "DuckDB",
      "duckdb",
    ];

    for (const sourceRoot of sourceRoots) {
      for (const file of tsFiles(join(root, sourceRoot))) {
        const relative = file.replace(`${root}/`, "");
        const source = readFileSync(file, "utf8");
        for (const token of forbidden) {
          expect(source, relative).not.toContain(token);
        }
      }
    }
  });

  test("bot transient and risk decisions are routed through named match helpers", () => {
    const bot = readFileSync(join(root, "src/application/Bot.ts"), "utf8");

    expect(bot).not.toContain("Bulk");
    expect(bot).not.toContain("isTransientBulkError");
    expect(bot).not.toContain("if (!isTransientBulkError(error))");
    expect(bot).not.toContain("runTickSafely");
    expect(bot).not.toContain('riskState === "EMERGENCY_STOP"');
    expect(bot).not.toContain('riskState === "PAUSE_QUOTING"');
    expect(bot).toContain("recoverableRuntimeErrorMessageOrThrow");
    expect(bot).toContain("handleRiskGate");
  });

  test("Bulk transient classification stays behind the Bulk adapter boundary", () => {
    const bulkTransientError = readFileSync(
      join(root, "src/adapters/bulk/BulkTransientError.ts"),
      "utf8",
    );
    const bot = readFileSync(join(root, "src/application/Bot.ts"), "utf8");

    expect(bulkTransientError).toContain("isTransientBulkError");
    expect(bulkTransientError).toContain("retryTransientBulk");
    expect(bot).not.toContain("BulkTransientError");
    expect(bot).toContain("isRecoverableVenueError");
  });

  test("Slack notification errors stay under lib slash slack", () => {
    const main = readFileSync(join(root, "src/main.ts"), "utf8");
    const slackWebhook = readFileSync(join(root, "src/lib/slack/SlackWebhook.ts"), "utf8");
    const slackError = readFileSync(join(root, "src/lib/slack/error.ts"), "utf8");
    const slackIndex = readFileSync(join(root, "src/lib/slack/index.ts"), "utf8");

    expect(main).not.toContain("utils/slackNotification");
    expect(main).toContain("lib/slack/notification");
    expect(slackWebhook).not.toContain("class SlackWebhookError");
    expect(slackError).toContain("export class SlackWebhookError");
    expect(slackError).toContain("export function getErrorLevel");
    expect(slackIndex).toContain("./error.ts");
    expect(slackIndex).toContain("./notification.ts");
    expect(slackIndex).not.toContain("errorLevels");
  });

  test("quote refresh concept is absent from runtime names", () => {
    for (const sourceRoot of sourceRoots) {
      for (const file of tsFiles(join(root, sourceRoot))) {
        const relative = file.replace(`${root}/`, "");
        const source = readFileSync(file, "utf8");
        expect(source, relative).not.toContain("QuoteRefresh");
        expect(source, relative).not.toContain("refreshQuotes");
      }
    }
  });
});

function tsFiles(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }

  const stats = statSync(path);
  if (stats.isFile()) {
    return path.endsWith(".ts") ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) => tsFiles(join(path, entry)));
}
