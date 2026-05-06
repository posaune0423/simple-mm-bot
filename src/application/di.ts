import { env } from "../env.ts";
import { BulkClient } from "bulk-ts-sdk";
import type { AppConfig } from "../config.ts";
import { BulkMarketFeed } from "../adapters/bulk/BulkMarketFeed.ts";
import { BulkOrderGateway } from "../adapters/bulk/BulkOrderGateway.ts";
import { HyperliquidMarketFeed } from "../adapters/hyperliquid/HyperliquidMarketFeed.ts";
import { HyperliquidOhlcvFetcher } from "../adapters/hyperliquid/HyperliquidOhlcvFetcher.ts";
import { HyperliquidOrderGateway } from "../adapters/hyperliquid/HyperliquidOrderGateway.ts";
import { HistoricalMarketFeed } from "../adapters/paper/HistoricalMarketFeed.ts";
import { PaperOrderGateway } from "../adapters/paper/PaperOrderGateway.ts";
import { FairPriceCalculator } from "../domain/FairPriceCalculator.ts";
import { QuoteEngine } from "../domain/QuoteEngine.ts";
import type { IMarketFeed } from "../domain/ports/IMarketFeed.ts";
import type { IOhlcvRepository } from "../domain/ports/IOhlcvRepository.ts";
import type { IOrderGateway } from "../domain/ports/IOrderGateway.ts";
import type { IMetricsRepository } from "../infrastructure/MetricsRepository.ts";
import type { ITradeRepository } from "../domain/ports/ITradeRepository.ts";
import { VolatilityEstimator } from "../domain/VolatilityEstimator.ts";
import { AvellanedaStoikovStrategy } from "../domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";
import { InMemoryPositionRepository } from "../infrastructure/InMemoryPositionRepository.ts";
import { createPostgresClient } from "../infrastructure/db/postgres/client.ts";
import { PostgresOhlcvRepository } from "../infrastructure/db/postgres/repository/PostgresOhlcvRepository.ts";
import { PostgresMetricsRepository } from "../infrastructure/db/postgres/repository/PostgresMetricsRepository.ts";
import { PostgresTradeRepository } from "../infrastructure/db/postgres/repository/PostgresTradeRepository.ts";
import { createSqliteClient } from "../infrastructure/db/sqlite/client.ts";
import { SqliteMetricsRepository } from "../infrastructure/db/sqlite/repository/SqliteMetricsRepository.ts";
import { SqliteOhlcvRepository } from "../infrastructure/db/sqlite/repository/SqliteOhlcvRepository.ts";
import { SqliteTradeRepository } from "../infrastructure/db/sqlite/repository/SqliteTradeRepository.ts";
import { HyperliquidExchangeApi } from "../lib/hyperliquid/HyperliquidExchangeApi.ts";
import { HyperliquidInfoApi } from "../lib/hyperliquid/HyperliquidInfoApi.ts";
import { HyperliquidSubscriptionApi } from "../lib/hyperliquid/HyperliquidSubscriptionApi.ts";
import { Bot } from "./Bot.ts";
import { MetricsRecorder } from "./MetricsRecorder.ts";
import { ClosePositionUseCase } from "./usecases/ClosePositionUseCase.ts";
import { GuardRiskUseCase } from "./usecases/GuardRiskUseCase.ts";
import { RecordFillUseCase } from "./usecases/RecordFillUseCase.ts";
import { RecordOhlcvUseCase } from "./usecases/RecordOhlcvUseCase.ts";
import { ReduceInventoryUseCase } from "./usecases/ReduceInventoryUseCase.ts";
import { RefreshQuotesUseCase } from "./usecases/RefreshQuotesUseCase.ts";

interface Repositories {
  tradeRepository: ITradeRepository;
  ohlcvRepository: IOhlcvRepository;
  metricsRepository: IMetricsRepository;
}

interface ResolvedAdapters {
  feed: IMarketFeed;
  gateway: IOrderGateway;
}

export class DIContainer {
  constructor(private readonly config: AppConfig) {}

  async buildBot(): Promise<Bot> {
    const repositories = this.createRepositories();
    const positionRepository = new InMemoryPositionRepository();
    const { feed, gateway } = this.resolveAdapters(repositories.ohlcvRepository);
    const quoteEngine = this.buildQuoteEngine();
    const metrics = this.buildMetricsRecorder(repositories.metricsRepository);

    return new Bot(
      {
        refreshQuotes: new RefreshQuotesUseCase(
          feed,
          gateway,
          positionRepository,
          quoteEngine,
          metrics,
        ),
        guardRisk: new GuardRiskUseCase(feed, this.config.risk),
        recordFill: new RecordFillUseCase(repositories.tradeRepository, positionRepository),
        recordOhlcv: new RecordOhlcvUseCase(repositories.ohlcvRepository),
        reduceInventory: new ReduceInventoryUseCase(
          gateway,
          positionRepository,
          feed,
          this.config.risk.maxPositionQty,
          this.marketName(),
        ),
        closePosition: new ClosePositionUseCase(
          gateway,
          positionRepository,
          feed,
          this.marketName(),
        ),
      },
      feed,
      gateway,
      this.config.bot.intervalMs,
      metrics,
    );
  }

  private buildQuoteEngine(): QuoteEngine {
    return new QuoteEngine(
      new AvellanedaStoikovStrategy(this.config.quoteEngine.strategy.params),
      new FairPriceCalculator(this.config.quoteEngine.markWeight),
      new VolatilityEstimator(),
      {
        inventoryScale: this.config.quoteEngine.inventoryScale,
        timeHorizonSec: this.config.quoteEngine.timeHorizonSec,
        slideMarginThreshold: this.config.quoteEngine.slideMarginThreshold,
        defaultTimeInForce: this.config.quoteEngine.defaultTimeInForce,
        positionSize: this.config.quoteEngine.sizing.positionSize,
        budgetUsd: this.config.quoteEngine.sizing.budgetUsd,
      },
    );
  }

  private createRepositories(): Repositories {
    const databaseUrl = Bun.env.DATABASE_URL ?? env.DATABASE_URL;
    if (databaseUrl) {
      const client = createPostgresClient(databaseUrl);
      return {
        tradeRepository: new PostgresTradeRepository(client.db),
        ohlcvRepository: new PostgresOhlcvRepository(client.db),
        metricsRepository: new PostgresMetricsRepository(client.db),
      };
    }

    const client = createSqliteClient(Bun.env.DB_PATH ?? env.DB_PATH);
    return {
      tradeRepository: new SqliteTradeRepository(client.db),
      ohlcvRepository: new SqliteOhlcvRepository(client.db),
      metricsRepository: new SqliteMetricsRepository(client.db),
    };
  }

  private buildMetricsRecorder(repository: IMetricsRepository): MetricsRecorder {
    return new MetricsRecorder(repository, {
      mode: this.config.mode,
      venue: this.config.venue,
      capitalMode: this.capitalMode(),
      market: this.marketName(),
      strategyName: "avellaneda-stoikov",
      configJson: redactConfig(this.config),
      ...gitMetadata(),
    });
  }

  private resolveAdapters(ohlcvRepository: IOhlcvRepository): ResolvedAdapters {
    if (this.config.venue === "bulk") {
      return this.resolveBulkAdapters();
    }

    const { connections, mode } = this.config;
    const infoApi = new HyperliquidInfoApi(connections.hyperliquid.httpUrl);

    if (mode === "backtest") {
      const feed = new HistoricalMarketFeed(ohlcvRepository, new HyperliquidOhlcvFetcher(infoApi), {
        market: this.config.backtest.market,
        timeframe: this.config.backtest.timeframe,
        from: Date.parse(this.config.backtest.from),
        to: Date.parse(this.config.backtest.to),
      });
      return {
        feed,
        gateway: new PaperOrderGateway(feed, this.config.paper.touchFillRatio),
      };
    }

    const subsApi = new HyperliquidSubscriptionApi({
      wsUrl: connections.hyperliquid.wsUrl,
      httpUrl: connections.hyperliquid.httpUrl,
    });
    const feed = new HyperliquidMarketFeed(infoApi, subsApi, {
      market: connections.hyperliquid.market,
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
              { market: connections.hyperliquid.market },
            )
          : new PaperOrderGateway(feed, this.config.paper.touchFillRatio),
    };
  }

  private resolveBulkAdapters(): ResolvedAdapters {
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
    });
    const accountId = client.accountPublicKey;

    if (mode === "backtest") {
      throw new Error("Bulk venue does not support backtest mode");
    }

    const feed = new BulkMarketFeed(client, {
      market: bulk.market,
      nlevels: bulk.nlevels,
      accountId,
    });

    if (mode === "paper") {
      return {
        feed,
        gateway: new PaperOrderGateway(feed, this.config.paper.touchFillRatio),
      };
    }

    if (!bulk.privateKey || !accountId) {
      throw new Error("BULK_PRIVATE_KEY is required for live Bulk order placement");
    }

    return {
      feed,
      gateway: new BulkOrderGateway(client, {
        market: bulk.market,
        accountId,
        maxLeverage: bulk.maxLeverage,
        pollIntervalMs: 1000,
      }),
    };
  }

  private requireSecretKey(secretKey: string | undefined): string {
    if (!secretKey) {
      throw new Error("HL_SECRET_KEY is required for live Hyperliquid order placement");
    }
    return secretKey;
  }

  private marketName(): string {
    return this.config.venue === "bulk"
      ? this.config.connections.bulk.market
      : this.config.connections.hyperliquid.market;
  }

  private capitalMode(): "beta_mock" | "paper" | "backtest" | "real" {
    if (this.config.mode === "paper") {
      return "paper";
    }
    if (this.config.mode === "backtest") {
      return "backtest";
    }
    if (this.config.venue === "bulk") {
      return "beta_mock";
    }
    return "real";
  }
}

function redactConfig(config: AppConfig): unknown {
  if (config.venue === "bulk") {
    return {
      ...config,
      connections: {
        bulk: {
          ...config.connections.bulk,
          privateKey: config.connections.bulk.privateKey === undefined ? undefined : "[redacted]",
        },
      },
    };
  }
  return {
    ...config,
    connections: {
      hyperliquid: {
        ...config.connections.hyperliquid,
        secretKey:
          config.connections.hyperliquid.secretKey === undefined ? undefined : "[redacted]",
      },
    },
  };
}

function gitMetadata(): { gitSha?: string; gitDirty: boolean } {
  const sha = runGit(["rev-parse", "--short", "HEAD"]);
  const status = runGit(["status", "--porcelain"]);
  return {
    gitSha: sha === "" ? undefined : sha,
    gitDirty: status !== "",
  };
}

function runGit(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  if (!result.success) {
    return "";
  }
  return new TextDecoder().decode(result.stdout).trim();
}
