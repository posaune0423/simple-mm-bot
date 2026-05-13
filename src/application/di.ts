import { env } from "../env.ts";
import { BulkClient } from "bulk-ts-sdk";
import { match } from "ts-pattern";
import type { LoadedAppConfig } from "../config.ts";
import { BulkMarketFeed } from "../adapters/bulk/BulkMarketFeed.ts";
import { BulkOhlcvFetcher } from "../adapters/bulk/BulkOhlcvFetcher.ts";
import { BulkOrderGateway } from "../adapters/bulk/BulkOrderGateway.ts";
import { HyperliquidMarketFeed } from "../adapters/hyperliquid/HyperliquidMarketFeed.ts";
import { HyperliquidOhlcvFetcher } from "../adapters/hyperliquid/HyperliquidOhlcvFetcher.ts";
import { HyperliquidOrderGateway } from "../adapters/hyperliquid/HyperliquidOrderGateway.ts";
import { HistoricalMarketFeed } from "../adapters/paper/HistoricalMarketFeed.ts";
import { PaperOrderGateway } from "../adapters/paper/PaperOrderGateway.ts";
import { FairPriceCalculator } from "../domain/services/FairPriceCalculator.ts";
import { QuoteEngine } from "../domain/services/QuoteEngine.ts";
import type { IMarketFeed } from "../domain/ports/IMarketFeed.ts";
import type { IOhlcvRepository } from "../domain/ports/IOhlcvRepository.ts";
import type { IOrderGateway } from "../domain/ports/IOrderGateway.ts";
import type { IMarkoutFeedbackRepository } from "../domain/ports/IMarkoutFeedbackRepository.ts";
import type { CapitalMode, IMetricsRepository } from "../domain/ports/IMetricsRepository.ts";
import { getGitMetadata } from "../infrastructure/GitMetadata.ts";
import { VolatilityEstimator } from "../domain/services/VolatilityEstimator.ts";
import { InMemoryPositionRepository } from "../infrastructure/InMemoryPositionRepository.ts";
import { createPostgresClient } from "../infrastructure/db/postgres/client.ts";
import { PostgresOhlcvRepository } from "../infrastructure/db/postgres/repository/PostgresOhlcvRepository.ts";
import { PostgresMetricsRepository } from "../infrastructure/db/postgres/repository/PostgresMetricsRepository.ts";
import { resolveDatabaseUrl } from "../utils/databaseUrl.ts";
import { createSqliteClient } from "../infrastructure/db/sqlite/client.ts";
import { SqliteMetricsRepository } from "../infrastructure/db/sqlite/repository/SqliteMetricsRepository.ts";
import { SqliteOhlcvRepository } from "../infrastructure/db/sqlite/repository/SqliteOhlcvRepository.ts";
import { HyperliquidExchangeApi } from "../lib/hyperliquid/HyperliquidExchangeApi.ts";
import { HyperliquidInfoApi } from "../lib/hyperliquid/HyperliquidInfoApi.ts";
import { HyperliquidSubscriptionApi } from "../lib/hyperliquid/HyperliquidSubscriptionApi.ts";
import { Bot } from "./Bot.ts";
import { MetricsBuffer, MetricsRecorder } from "./services/MetricsRecorder.ts";
import { OrderReconciler, type OrderReconcilerOptions } from "./services/OrderReconciler.ts";
import { buildQuoteModel } from "./factories/QuoteModelFactory.ts";
import { buildStrategy } from "./factories/StrategyFactory.ts";
import { OrderIntentBuilder } from "./services/OrderIntentBuilder.ts";
import { QuotingCycleService } from "./services/QuotingCycleService.ts";
import { BufferedRecordOhlcvUseCase } from "./usecases/BufferedRecordOhlcvUseCase.ts";
import { ClosePositionUseCase } from "./usecases/ClosePositionUseCase.ts";
import { GuardRiskUseCase } from "./usecases/GuardRiskUseCase.ts";
import { InitializePositionUseCase } from "./usecases/InitializePositionUseCase.ts";
import { SyncPositionUseCase } from "./usecases/SyncPositionUseCase.ts";
import { RecordOhlcvUseCase } from "./usecases/RecordOhlcvUseCase.ts";
import { ReduceInventoryUseCase } from "./usecases/ReduceInventoryUseCase.ts";
import { UpdatePositionOnFillUseCase } from "./usecases/UpdatePositionOnFillUseCase.ts";

interface Repositories {
  ohlcvRepository: IOhlcvRepository;
  metricsRepository: IMetricsRepository;
  markoutFeedbackRepository?: IMarkoutFeedbackRepository;
}

interface ResolvedAdapters {
  feed: IMarketFeed;
  gateway: IOrderGateway;
}

export class DIContainer {
  constructor(private readonly config: LoadedAppConfig) {}

  async buildBot(): Promise<Bot> {
    const repositories = this.createRepositories();
    const positionRepository = new InMemoryPositionRepository();
    const { feed, gateway } = this.resolveAdapters(repositories.ohlcvRepository);
    const quoteEngine = this.buildQuoteEngine();
    const strategy = buildStrategy({
      kind: "simple_pmm",
      quoteEngine,
      markoutFeedbackGate: this.config.quoteEngine.qualityGate,
    });
    const metricsBuffer = this.buildMetricsBuffer();
    const metrics = this.buildMetricsRecorder(repositories.metricsRepository, metricsBuffer);
    const orderReconciler = new OrderReconciler(gateway, this.orderReconcilerOptions());

    return new Bot(
      {
        quotingCycle: new QuotingCycleService(
          feed,
          positionRepository,
          strategy,
          new OrderIntentBuilder(),
          orderReconciler,
          {
            defaultTimeInForce: this.config.quoteEngine.defaultTimeInForce,
            postOnly: this.config.quoteEngine.defaultTimeInForce === "ALO",
            slideMarginThreshold: this.config.quoteEngine.slideMarginThreshold,
          },
          metrics,
          repositories.markoutFeedbackRepository,
          this.config.quoteEngine.qualityGate,
        ),
        guardRisk: new GuardRiskUseCase(feed, this.config.risk),
        initializePosition: new InitializePositionUseCase(
          gateway,
          positionRepository,
          bulkLiveStartupRetryOptions(this.config),
        ),
        syncPosition: new SyncPositionUseCase(gateway, positionRepository),
        updatePositionOnFill: new UpdatePositionOnFillUseCase(positionRepository),
        recordOhlcv: new BufferedRecordOhlcvUseCase(
          new RecordOhlcvUseCase(repositories.ohlcvRepository),
          metricsBuffer,
        ),
        reduceInventory: new ReduceInventoryUseCase(
          gateway,
          positionRepository,
          feed,
          this.config.risk.maxPositionQty,
          this.config.market,
          {
            reduceTriggerQty: this.config.risk.reduceTriggerQty,
            reduceTargetQty: this.config.risk.reduceTargetQty,
            maxUnrealizedLossUsd: this.config.risk.maxUnrealizedLossUsd,
            maxAdverseMoveBps: this.config.risk.maxAdverseMoveBps,
          },
        ),
        closePosition: new ClosePositionUseCase(
          gateway,
          positionRepository,
          feed,
          this.config.market,
        ),
      },
      feed,
      gateway,
      this.config.bot.intervalMs,
      metrics,
      { closePositionPolicy: this.config.shutdown.closePositionPolicy },
    );
  }

  private buildQuoteEngine(): QuoteEngine {
    const quoteModel = buildQuoteModel(this.config.quoteEngine.strategy);
    return new QuoteEngine(
      quoteModel,
      new FairPriceCalculator(
        this.config.quoteEngine.markWeight,
        this.config.quoteEngine.bookPriceSource,
      ),
      new VolatilityEstimator(),
      {
        inventoryScale: this.config.quoteEngine.inventoryScale,
        timeHorizonSec: this.config.quoteEngine.timeHorizonSec,
        minSpreadBps: this.config.quoteEngine.minSpreadBps,
        positionSize: this.config.quoteEngine.sizing.positionSize,
        budgetUsd: this.config.quoteEngine.sizing.budgetUsd,
        bidSizeMultiplier: this.config.quoteEngine.sizing.bidSizeMultiplier,
        askSizeMultiplier: this.config.quoteEngine.sizing.askSizeMultiplier,
        bidDistanceMultiplier: this.config.quoteEngine.sizing.bidDistanceMultiplier,
        askDistanceMultiplier: this.config.quoteEngine.sizing.askDistanceMultiplier,
        maxLeverage: match(this.config)
          .with({ venue: "bulk" }, (config) => config.connections.bulk.maxLeverage)
          .otherwise(() => undefined),
        levels: this.config.quoteEngine.levels,
      },
    );
  }

  private createRepositories(): Repositories {
    const database = resolveDatabaseUrl(Bun.env.DATABASE_URL ?? env.DATABASE_URL);
    return match(database)
      .with({ kind: "postgres" }, (database) => {
        const client = createPostgresClient(database.url);
        return {
          ohlcvRepository: new PostgresOhlcvRepository(client.db),
          metricsRepository: new PostgresMetricsRepository(client.db),
        };
      })
      .with({ kind: "sqlite" }, (database) => {
        const client = createSqliteClient(database.path);
        const metricsRepository = new SqliteMetricsRepository(client.db);
        return {
          ohlcvRepository: new SqliteOhlcvRepository(client.db),
          metricsRepository,
          markoutFeedbackRepository: metricsRepository,
        };
      })
      .exhaustive();
  }

  private buildMetricsRecorder(
    repository: IMetricsRepository,
    buffer: MetricsBuffer,
  ): MetricsRecorder {
    return new MetricsRecorder(
      repository,
      {
        mode: this.config.mode,
        venue: this.config.venue,
        capitalMode: resolveCapitalMode(this.config),
        market: this.config.market,
        strategyName: buildQuoteModel(this.config.quoteEngine.strategy).name,
        configJson: redactConfig(this.config),
        ...getGitMetadata(),
      },
      buffer,
    );
  }

  private buildMetricsBuffer(): MetricsBuffer {
    return match(this.config.mode)
      .with(
        "backtest",
        () => new MetricsBuffer({ normalCapacity: 100_000, criticalCapacity: 100_000 }),
      )
      .otherwise(() => new MetricsBuffer());
  }

  private resolveAdapters(ohlcvRepository: IOhlcvRepository): ResolvedAdapters {
    return match(this.config)
      .with({ venue: "bulk" }, () => this.resolveBulkAdapters(ohlcvRepository))
      .with({ venue: "hyperliquid" }, (config) =>
        this.resolveHyperliquidAdapters(config, ohlcvRepository),
      )
      .exhaustive();
  }

  private resolveHyperliquidAdapters(
    config: Extract<LoadedAppConfig, { venue: "hyperliquid" }>,
    ohlcvRepository: IOhlcvRepository,
  ): ResolvedAdapters {
    const { connections, mode } = config;
    const infoApi = new HyperliquidInfoApi(connections.hyperliquid.httpUrl);

    return match(mode)
      .with("backtest", () => {
        const feed = new HistoricalMarketFeed(
          ohlcvRepository,
          new HyperliquidOhlcvFetcher(infoApi),
          {
            market: config.backtest.market,
            timeframe: config.backtest.timeframe,
            from: Date.parse(config.backtest.from),
            to: Date.parse(config.backtest.to),
          },
        );
        return {
          feed,
          gateway: new PaperOrderGateway(feed, config.paper.touchFillRatio),
        };
      })
      .otherwise(() => {
        const subsApi = new HyperliquidSubscriptionApi({
          wsUrl: connections.hyperliquid.wsUrl,
          httpUrl: connections.hyperliquid.httpUrl,
        });
        const feed = new HyperliquidMarketFeed(infoApi, subsApi, {
          market: config.market,
          accountAddress: connections.hyperliquid.accountAddress,
        });

        return {
          feed,
          gateway:
            mode === "live"
              ? new HyperliquidOrderGateway(
                  infoApi,
                  new HyperliquidExchangeApi({
                    httpUrl: connections.hyperliquid.httpUrl,
                    privateKey: this.requireSecretKey(connections.hyperliquid.secretKey),
                  }),
                  { market: config.market },
                )
              : new PaperOrderGateway(feed, config.paper.touchFillRatio),
        };
      });
  }

  private resolveBulkAdapters(ohlcvRepository: IOhlcvRepository): ResolvedAdapters {
    const config = this.config;
    if (config.venue !== "bulk") {
      throw new Error("Bulk adapters can only be resolved for Bulk config");
    }

    const { mode } = config;
    const { bulk } = config.connections;
    const client = new BulkClient({
      httpUrl: bulk.httpUrl,
      wsUrl: bulk.wsUrl,
      privateKey: bulk.privateKey,
      timeoutMs: bulk.timeoutMs,
    });
    const accountId = client.accountPublicKey;

    return match(mode)
      .with("backtest", () => {
        const feed = new HistoricalMarketFeed(ohlcvRepository, new BulkOhlcvFetcher(client), {
          market: config.backtest.market,
          timeframe: config.backtest.timeframe,
          from: Date.parse(config.backtest.from),
          to: Date.parse(config.backtest.to),
        });
        return {
          feed,
          gateway: new PaperOrderGateway(feed, this.config.paper.touchFillRatio),
        };
      })
      .otherwise((mode) => {
        const feed = new BulkMarketFeed(client, {
          market: config.market,
          nlevels: bulk.nlevels,
          accountId,
          marketWsReconnectAfterMs: bulk.marketWsReconnectAfterMs,
          ...bulkLiveStartupRetryOptions(config),
        });

        return match(mode)
          .with("paper", () => ({
            feed,
            gateway: new PaperOrderGateway(feed, this.config.paper.touchFillRatio),
          }))
          .with("live", () => {
            if (!bulk.privateKey || !accountId) {
              throw new Error("BULK_PRIVATE_KEY is required for live Bulk order placement");
            }

            return {
              feed,
              gateway: new BulkOrderGateway(client, {
                market: config.market,
                accountId,
                maxLeverage: bulk.maxLeverage,
                pollIntervalMs: 1000,
                ignoreFillsBeforeMs: Date.now(),
              }),
            };
          })
          .exhaustive();
      });
  }

  private requireSecretKey(secretKey: string | undefined): string {
    if (!secretKey) {
      throw new Error("HL_SECRET_KEY is required for live Hyperliquid order placement");
    }
    return secretKey;
  }

  private orderReconcilerOptions(): Partial<OrderReconcilerOptions> {
    const options: Partial<OrderReconcilerOptions> = {};
    if (this.config.bot.maxRestingMs !== undefined) {
      options.maxRestingMs = this.config.bot.maxRestingMs;
    }
    if (this.config.bot.exchangeOpenOrderSyncIntervalMs !== undefined) {
      options.exchangeOpenOrderSyncIntervalMs = this.config.bot.exchangeOpenOrderSyncIntervalMs;
    }
    return options;
  }
}

export function resolveCapitalMode(config: LoadedAppConfig): CapitalMode {
  return match(config)
    .with({ mode: "paper" }, () => "paper" as const)
    .with({ mode: "backtest" }, () => "backtest" as const)
    .with(
      { venue: "bulk", connections: { bulk: { environment: "beta" } } },
      () => "beta_mock" as const,
    )
    .otherwise(() => "real" as const);
}

function bulkLiveStartupRetryOptions(config: LoadedAppConfig): {
  retryAttempts?: number;
  retryDelayMs?: number;
  accountRetryAttempts?: number;
  accountRetryDelayMs?: number;
} {
  return match(config)
    .with({ venue: "bulk", mode: "live" }, () => ({
      retryAttempts: 6,
      retryDelayMs: 1_000,
      accountRetryAttempts: 6,
      accountRetryDelayMs: 1_000,
    }))
    .otherwise(() => ({}));
}

function redactConfig(config: LoadedAppConfig): unknown {
  return match(config)
    .with({ venue: "bulk" }, (config) => ({
      ...config,
      connections: {
        bulk: {
          ...config.connections.bulk,
          privateKey: config.connections.bulk.privateKey === undefined ? undefined : "[redacted]",
        },
      },
    }))
    .with({ venue: "hyperliquid" }, (config) => ({
      ...config,
      connections: {
        hyperliquid: {
          ...config.connections.hyperliquid,
          secretKey:
            config.connections.hyperliquid.secretKey === undefined ? undefined : "[redacted]",
        },
      },
    }))
    .exhaustive();
}
