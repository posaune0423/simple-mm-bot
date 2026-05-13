import { randomUUID } from "node:crypto";
import type { IMarketFeed, MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import type { IMarkoutFeedbackRepository } from "../../domain/ports/IMarkoutFeedbackRepository.ts";
import {
  StrategyDecision,
  type SideMarkoutFeedback,
  type Strategy,
} from "../../domain/strategies/Strategy.ts";
import type { Quote } from "../../domain/value-objects/Quote.ts";
import { PositionSnapshot } from "../../domain/value-objects/PositionSnapshot.ts";
import type { OrderTimeInForce } from "../../domain/types/Order.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";
import type { MetricsRecorder } from "./MetricsRecorder.ts";
import type { OrderIntentBuilder, OrderIntentBuildResult } from "./OrderIntentBuilder.ts";
import type { OrderReconciler, ReconcileResult } from "./OrderReconciler.ts";
import { toLegacyQuoteForMetrics } from "./QuoteMetricsAdapter.ts";

export type QuoteRefreshExecutionConfig = Readonly<{
  defaultTimeInForce: OrderTimeInForce;
  postOnly: boolean;
}>;

export type QuoteRefreshMarkoutFeedbackConfig = Readonly<{
  enabled: boolean;
  lookbackFills?: number;
  maxFillAgeMs?: number;
  horizonsSec: readonly number[];
}>;

export class QuoteRefreshService {
  private previousPlacementMid: number | null = null;

  constructor(
    private readonly marketFeed: IMarketFeed,
    private readonly positionRepository: IPositionRepository,
    private readonly strategy: Strategy,
    private readonly orderIntentBuilder: OrderIntentBuilder,
    private readonly orderReconciler: OrderReconciler,
    private readonly execution: QuoteRefreshExecutionConfig,
    private readonly metrics?: MetricsRecorder,
    private readonly markoutFeedbackRepository?: IMarkoutFeedbackRepository,
    private readonly markoutFeedbackGate: QuoteRefreshMarkoutFeedbackConfig = {
      enabled: false,
      lookbackFills: 100,
      horizonsSec: [5, 30, 300],
    },
  ) {}

  async execute(): Promise<void> {
    const cycleStartedAt = Date.now();
    const [snapshot, position] = await Promise.all([
      this.marketFeed.getSnapshot(),
      this.positionRepository.get(),
    ]);
    const quoteCycleId = randomUUID();
    const decisionMid = midPrice(snapshot);
    const bookAgeMsAtDecision = Math.max(
      0,
      Date.now() - (snapshot.bookUpdatedAt ?? snapshot.timestamp),
    );
    const tickerAgeMsAtDecision = Math.max(
      0,
      Date.now() - (snapshot.tickerUpdatedAt ?? snapshot.timestamp),
    );
    const qualityGateStartedAt = Date.now();
    const markoutFeedback = await this.readMarkoutFeedback(snapshot);
    const qualityGateMs = Date.now() - qualityGateStartedAt;
    const positionSnapshot = PositionSnapshot.create({
      market: snapshot.market,
      signedQuantity: position.qty,
      averageEntryPrice: position.avgEntry,
      unrealizedPnl: position.unrealizedPnl,
    });
    if (positionSnapshot.isErr()) {
      await this.recordRuntimeHealth(
        "error",
        "strategy_input_invalid",
        positionSnapshot.error.message,
        {
          market: snapshot.market,
        },
      );
      return;
    }

    const quoteComputeStartedAt = Date.now();
    const decision = this.strategy.decide({
      snapshot,
      position: positionSnapshot.value,
      markoutFeedback,
      nowMs: Date.now(),
    });
    const quoteComputeMs = Date.now() - quoteComputeStartedAt;

    await decision.match(
      async (strategyDecision) =>
        StrategyDecision.match(strategyDecision, {
          quote: async (quoteDecision) => {
            await this.handleQuoteDecision({
              quote: quoteDecision.quote,
              quoteCycleId,
              snapshot,
              positionQty: position.qty,
              markoutFeedback,
              cycleStartedAt,
              qualityGateMs,
              quoteComputeMs,
              bookAgeMsAtDecision,
              tickerAgeMsAtDecision,
              decisionMid,
            });
          },
          noQuote: async (noQuoteDecision) => {
            if (noQuoteDecision.cancelExisting) {
              const cancelResult = await this.orderReconciler.cancelAll(
                noQuoteDecision.reasonTags.join(","),
              );
              await cancelResult.match(
                async () => undefined,
                async (error) =>
                  this.recordRuntimeHealth(
                    "error",
                    "quote_cancel_all_failed",
                    stringifyError(error),
                  ),
              );
            }
            await this.recordRuntimeHealth(
              "info",
              "strategy_no_quote",
              "Strategy returned no_quote",
              {
                reasonTags: noQuoteDecision.reasonTags,
              },
            );
          },
        }),
      async (error) =>
        this.recordRuntimeHealth("error", "strategy_decision_failed", stringifyError(error), error),
    );
  }

  private async handleQuoteDecision(input: {
    quote: Quote;
    quoteCycleId: string;
    snapshot: MarketSnapshot;
    positionQty: number;
    markoutFeedback: readonly SideMarkoutFeedback[];
    cycleStartedAt: number;
    qualityGateMs: number;
    quoteComputeMs: number;
    bookAgeMsAtDecision: number;
    tickerAgeMsAtDecision: number;
    decisionMid: number;
  }): Promise<void> {
    logger.info(
      `[application] QuoteRefresh | QUOTE_CREATED | market=${input.snapshot.market} bid=${input.quote.bids[0]?.price ?? "none"} ask=${input.quote.asks[0]?.price ?? "none"} bidSize=${input.quote.bids[0]?.size ?? 0} askSize=${input.quote.asks[0]?.size ?? 0} bidIntent=${input.quote.bids[0]?.exposureIntent ?? "disabled"} askIntent=${input.quote.asks[0]?.exposureIntent ?? "disabled"} levelCount=${Math.max(input.quote.bids.length, input.quote.asks.length)} policy=${this.execution.defaultTimeInForce} positionQty=${input.positionQty}`,
    );
    await this.recordRuntimeHealth("info", "quote_build_summary", "Quote build summary captured", {
      market: input.snapshot.market,
      quoteCycleId: input.quoteCycleId,
      positionQty: input.positionQty,
      quote: quoteSummary(input.quote),
      markoutFeedback: input.markoutFeedback,
    });

    const recordQuoteStartedAt = Date.now();
    await this.metrics?.recordQuote(
      input.snapshot,
      input.positionQty,
      toLegacyQuoteForMetrics(input.quote, this.execution.defaultTimeInForce),
      input.quoteCycleId,
    );
    const recordQuoteMs = Date.now() - recordQuoteStartedAt;

    const trendSnapshot = await this.marketFeed.getSnapshot();
    const placementMid = midPrice(trendSnapshot);
    const trendBps =
      this.previousPlacementMid !== null && this.previousPlacementMid > 0
        ? ((placementMid - this.previousPlacementMid) / this.previousPlacementMid) * 10_000
        : 0;
    this.previousPlacementMid = placementMid;

    const buildOrdersStartedAt = Date.now();
    const buildResult = this.orderIntentBuilder.build({
      quote: input.quote,
      quoteCycleId: input.quoteCycleId,
      execution: this.execution,
      placement: {
        trendBps,
        touchByLegKey: await this.collectPlacementContext(input.quote),
      },
    });
    const buildOrdersMs = Date.now() - buildOrdersStartedAt;
    if (buildResult.isErr()) {
      await this.recordRuntimeHealth(
        "error",
        "order_intent_build_failed",
        buildResult.error.message,
        buildResult.error,
      );
      return;
    }

    await this.recordSkippedIntents(buildResult.value);

    const submitSnapshot = await this.marketFeed.getSnapshot();
    const submitObservedAt = Date.now();
    const submitMid = midPrice(submitSnapshot);
    const reconcileStartedAt = Date.now();
    const reconcile = await this.orderReconciler.reconcile(buildResult.value.intents);
    await reconcile.match(
      async (result) =>
        this.recordReconcileSuccess({
          result,
          snapshot: input.snapshot,
          targetOrderCount: buildResult.value.intents.length,
          skippedCount: buildResult.value.skipped.length,
          reconcileMs: Date.now() - reconcileStartedAt,
          totalRefreshMs: Date.now() - input.cycleStartedAt,
          qualityGateMs: input.qualityGateMs,
          quoteComputeMs: input.quoteComputeMs,
          recordQuoteMs,
          buildOrdersMs,
          bookAgeMsAtDecision: input.bookAgeMsAtDecision,
          tickerAgeMsAtDecision: input.tickerAgeMsAtDecision,
          bookAgeMsAtSubmit: Math.max(
            0,
            submitObservedAt - (submitSnapshot.bookUpdatedAt ?? submitSnapshot.timestamp),
          ),
          decisionMid: input.decisionMid,
          submitMid,
          midMoveDuringRefreshBps:
            input.decisionMid > 0
              ? ((submitMid - input.decisionMid) / input.decisionMid) * 10_000
              : 0,
          quoteCycleId: input.quoteCycleId,
        }),
      async (error) =>
        this.recordRuntimeHealth("error", "order_reconcile_failed", stringifyError(error), error),
    );
  }

  private async readMarkoutFeedback(
    snapshot: MarketSnapshot,
  ): Promise<readonly SideMarkoutFeedback[]> {
    if (!this.markoutFeedbackGate.enabled || this.markoutFeedbackRepository === undefined) {
      return [];
    }
    try {
      return await this.markoutFeedbackRepository.getRecentSideMarkoutFeedback({
        market: snapshot.market,
        lookbackFills: this.markoutFeedbackGate.lookbackFills ?? 100,
        ...(this.markoutFeedbackGate.maxFillAgeMs === undefined
          ? {}
          : { minFilledAt: Date.now() - this.markoutFeedbackGate.maxFillAgeMs }),
        horizonsSec: [...this.markoutFeedbackGate.horizonsSec],
      });
    } catch (error) {
      logger.warn(
        `[application] QuoteRefresh | MARKOUT_FEEDBACK_READ_FAILED | market=${snapshot.market} error=${stringifyError(error)}`,
      );
      return [];
    }
  }

  private async collectPlacementContext(
    quote: Quote,
  ): Promise<ReadonlyMap<string, MarketSnapshot>> {
    const touchByLegKey = new Map<string, MarketSnapshot>();
    for (const leg of [...quote.bids, ...quote.asks]) {
      const snapshot = await this.marketFeed.getSnapshot();
      await this.metrics?.recordMarketSnapshot(snapshot);
      touchByLegKey.set(`${leg.side}:${leg.level}`, snapshot);
    }
    return touchByLegKey;
  }

  private async recordSkippedIntents(buildResult: OrderIntentBuildResult): Promise<void> {
    for (const skipped of buildResult.skipped) {
      const healthLevel = skipped.reason === "stale_touch" ? "warn" : "info";
      await this.recordRuntimeHealth(
        healthLevel,
        "quote_side_skipped",
        "Skipped quote side before placement",
        skipped,
      );
    }
  }

  private async recordReconcileSuccess(input: {
    result: ReconcileResult;
    snapshot: MarketSnapshot;
    targetOrderCount: number;
    skippedCount: number;
    reconcileMs: number;
    totalRefreshMs: number;
    qualityGateMs: number;
    quoteComputeMs: number;
    recordQuoteMs: number;
    buildOrdersMs: number;
    bookAgeMsAtDecision: number;
    tickerAgeMsAtDecision: number;
    bookAgeMsAtSubmit: number;
    decisionMid: number;
    submitMid: number;
    midMoveDuringRefreshBps: number;
    quoteCycleId: string;
  }): Promise<void> {
    await this.recordRuntimeHealth(
      "info",
      "quote_cycle_freshness",
      "Quote cycle freshness measured",
      {
        market: input.snapshot.market,
        qualityGateMs: input.qualityGateMs,
        quoteComputeMs: input.quoteComputeMs,
        recordQuoteMs: input.recordQuoteMs,
        buildOrdersMs: input.buildOrdersMs,
        reconcileMs: input.reconcileMs,
        totalRefreshMs: input.totalRefreshMs,
        bookAgeMsAtDecision: input.bookAgeMsAtDecision,
        tickerAgeMsAtDecision: input.tickerAgeMsAtDecision,
        bookAgeMsAtSubmit: input.bookAgeMsAtSubmit,
        decisionMid: input.decisionMid,
        submitMid: input.submitMid,
        midMoveDuringRefreshBps: input.midMoveDuringRefreshBps,
        targetOrderCount: input.targetOrderCount,
        activeOrderCount: input.result.activeOrders.length,
        skippedCount: input.skippedCount,
        quoteCycleId: input.quoteCycleId,
      },
    );
    if (input.result.activeOrders.length === 0) {
      logger.info(
        `[application] QuoteRefresh | NO_ACTIVE_ORDERS | market=${input.snapshot.market} targetCount=${input.targetOrderCount} rejectedOrSkipped=true`,
      );
      await this.recordRuntimeHealth(
        "info",
        "quote_placement_no_active_orders",
        "No quote orders were submitted",
        { market: input.snapshot.market, targetCount: input.targetOrderCount },
      );
      return;
    }

    const bidOrder = input.result.activeOrders.find((entry) => entry.side === "buy")?.order;
    const askOrder = input.result.activeOrders.find((entry) => entry.side === "sell")?.order;
    logger.info(
      `[application] QuoteRefresh | ORDERS_SUBMITTED | market=${input.snapshot.market} bidOrderId=${bidOrder?.id ?? "none"} bidStatus=${bidOrder?.status ?? "skipped"} askOrderId=${askOrder?.id ?? "none"} askStatus=${askOrder?.status ?? "skipped"}`,
    );
  }

  private async recordRuntimeHealth(
    level: "info" | "warn" | "error",
    code: string,
    message: string,
    rawSummary?: unknown,
  ): Promise<void> {
    if (this.metrics === undefined || typeof this.metrics.recordRuntimeHealth !== "function") {
      return;
    }
    try {
      await this.metrics.recordRuntimeHealth(level, code, message, rawSummary);
    } catch (error) {
      logger.warn(
        `[application] QuoteRefresh | RUNTIME_HEALTH_RECORD_FAILED | code=${code} error=${stringifyError(error)}`,
      );
    }
  }
}

function quoteSummary(quote: Quote) {
  return {
    fairPrice: quote.fairPrice,
    referencePrice: quote.referencePrice,
    reservationPrice: quote.reservationPrice,
    sigma: quote.sigma,
    bids: quote.bids,
    asks: quote.asks,
    diagnostics: quote.diagnostics,
  };
}

function midPrice(snapshot: MarketSnapshot): number {
  return (snapshot.bestBid + snapshot.bestAsk) / 2;
}
