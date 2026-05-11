import { randomUUID } from "node:crypto";

import type { QuoteEngine } from "../../domain/QuoteEngine.ts";
import {
  QuoteControlPolicy,
  type QuoteQualityGateConfig,
} from "../../domain/QuoteControlPolicy.ts";
import type { OrderSide, QuoteLevel, QuoteSideIntent } from "../../domain/entities/Quote.ts";
import type { IMarketFeed, MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import type { IQuoteQualityRepository } from "../../domain/ports/IQuoteQualityRepository.ts";
import type { QuoteSideQuality } from "../../domain/QuoteQuality.ts";
import type { QuoteControls } from "../../domain/QuoteControls.ts";
import { stringifyError } from "../../utils/errors.ts";
import type { MetricsRecorder } from "../MetricsRecorder.ts";
import {
  OrderManager,
  type ManagedOrderRequest,
  type OrderManagerOptions,
} from "../OrderManager.ts";
import { logger } from "../../utils/logger.ts";

const NORMAL_PASSIVE_TOUCH_MARGIN_BPS = 0.25;
const REDUCE_PASSIVE_TOUCH_MARGIN_BPS = 0.05;
const MAX_OPEN_QUOTE_TOUCH_STALENESS_MS = 1_500;
const EPOCH_MS_LOWER_BOUND = 1_000_000_000_000;
const MOMENTUM_GUARD_THRESHOLD_BPS = 0.05;
const OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS = 2;
const MOMENTUM_GUARD_MULTIPLIER = 1;
const MAX_MOMENTUM_GUARD_BPS = 8;

interface RefreshQuotesUseCaseOptions {
  orderManager?: Partial<OrderManagerOptions>;
}

export class RefreshQuotesUseCase {
  private previousPlacementMid: number | null = null;
  private readonly orderManager: OrderManager;

  constructor(
    private readonly marketFeed: IMarketFeed,
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly quoteEngine: QuoteEngine,
    private readonly metrics?: MetricsRecorder,
    private readonly quoteQualityRepository?: IQuoteQualityRepository,
    qualityGate: QuoteQualityGateConfig = {
      enabled: false,
      minAverageMarkoutBps: 0,
      minSamples: 20,
      lookbackFills: 100,
      horizonsSec: [5, 30, 300],
    },
    options: RefreshQuotesUseCaseOptions = {},
  ) {
    this.orderManager = new OrderManager(orderGateway, options.orderManager);
    this.qualityGate = qualityGate;
    this.quoteControlPolicy = new QuoteControlPolicy(qualityGate);
  }

  private readonly qualityGate: QuoteQualityGateConfig;
  private readonly quoteControlPolicy: QuoteControlPolicy;

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
        `[application] RefreshQuotes | RUNTIME_HEALTH_RECORD_FAILED | code=${code} error=${stringifyError(error)}`,
      );
    }
  }

  async execute(): Promise<void> {
    const cycleStartedAt = Date.now();
    await this.marketFeed.getSnapshot();
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
    const quoteQuality =
      !this.qualityGate.enabled || this.quoteQualityRepository === undefined
        ? []
        : await this.quoteQualityRepository.getRecentSideQuality({
            market: snapshot.market,
            lookbackFills: this.qualityGate.lookbackFills ?? 100,
            ...(this.qualityGate.maxFillAgeMs === undefined
              ? {}
              : { minFilledAt: Date.now() - this.qualityGate.maxFillAgeMs }),
            horizonsSec: this.qualityGate.horizonsSec,
          });
    const qualityGateMs = Date.now() - qualityGateStartedAt;

    const quoteComputeStartedAt = Date.now();
    const quoteControls = this.quoteControlPolicy.controlsFor(quoteQuality, {
      positionQty: position.qty,
    });
    const quote = this.quoteEngine.compute(snapshot, position, quoteControls);
    const levels = quoteLevels(quote);
    const quoteComputeMs = Date.now() - quoteComputeStartedAt;
    logger.info(
      `[application] RefreshQuotes | QUOTE_CREATED | market=${snapshot.market} bid=${quote.bid} ask=${quote.ask} bidSize=${quote.bidSize} askSize=${quote.askSize} bidIntent=${levels[0]?.bidIntent ?? "unknown"} askIntent=${levels[0]?.askIntent ?? "unknown"} bidReasons=${formatReasonTags(levels[0]?.bidControlReasons)} askReasons=${formatReasonTags(levels[0]?.askControlReasons)} levelCount=${levels.length} policy=${quote.policy} positionQty=${position.qty}`,
    );
    await this.recordRuntimeHealth(
      "info",
      "quote_build_summary",
      "Quote build summary captured",
      quoteBuildSummary({
        market: snapshot.market,
        quoteCycleId,
        positionQty: position.qty,
        quote,
        levels,
        quoteControls,
        quoteQuality,
        qualityGate: this.qualityGate,
      }),
    );
    const recordQuoteStartedAt = Date.now();
    await this.metrics?.recordQuote(snapshot, position.qty, quote, quoteCycleId);
    const recordQuoteMs = Date.now() - recordQuoteStartedAt;
    const trendSnapshot = await this.marketFeed.getSnapshot();
    const placementMid = midPrice(trendSnapshot);
    const trendBps =
      this.previousPlacementMid !== null && this.previousPlacementMid > 0
        ? ((placementMid - this.previousPlacementMid) / this.previousPlacementMid) * 10_000
        : 0;
    this.previousPlacementMid = placementMid;
    const targetOrders: ManagedOrderRequest[] = [];
    const buildOrdersStartedAt = Date.now();
    let skippedCount = 0;
    for (const level of levels) {
      const suffix = quote.levels === undefined ? "" : `:${level.level}`;
      if (shouldSubmitSide(level.bidSize, level.bidIntent)) {
        const bidRequest = await this.guardedOrderRequest({
          key: `bid${suffix}`,
          market: snapshot.market,
          side: "buy",
          price: level.bid,
          qty: level.bidSize,
          reduceOnly: level.bidIntent === "reduce_inventory",
          timeInForce: quote.policy,
          clientOrderId: `${quoteCycleId}:bid${suffix}`,
          intent: orderIntent(level.bidIntent),
          trendBps,
        });
        if (bidRequest !== undefined) {
          targetOrders.push(bidRequest);
        } else {
          skippedCount += 1;
        }
      }
      if (shouldSubmitSide(level.askSize, level.askIntent)) {
        const askRequest = await this.guardedOrderRequest({
          key: `ask${suffix}`,
          market: snapshot.market,
          side: "sell",
          price: level.ask,
          qty: level.askSize,
          reduceOnly: level.askIntent === "reduce_inventory",
          timeInForce: quote.policy,
          clientOrderId: `${quoteCycleId}:ask${suffix}`,
          intent: orderIntent(level.askIntent),
          trendBps,
        });
        if (askRequest !== undefined) {
          targetOrders.push(askRequest);
        } else {
          skippedCount += 1;
        }
      }
    }
    const buildOrdersMs = Date.now() - buildOrdersStartedAt;
    const shouldMeasureSubmitFreshness =
      this.metrics !== undefined && typeof this.metrics.recordRuntimeHealth === "function";
    const submitSnapshot = shouldMeasureSubmitFreshness
      ? await this.marketFeed.getSnapshot()
      : trendSnapshot;
    const submitObservedAt = Date.now();
    const submitMid = midPrice(submitSnapshot);
    const reconcileStartedAt = Date.now();
    const activeOrders = await this.orderManager.reconcile(targetOrders);
    const orderManagerState = this.orderManager.state();
    const reconcileMs = Date.now() - reconcileStartedAt;
    const bookAgeMsAtSubmit = Math.max(
      0,
      submitObservedAt - (submitSnapshot.bookUpdatedAt ?? submitSnapshot.timestamp),
    );
    const midMoveDuringRefreshBps =
      decisionMid > 0 ? ((submitMid - decisionMid) / decisionMid) * 10_000 : 0;
    const totalRefreshMs = Date.now() - cycleStartedAt;
    await this.recordRuntimeHealth(
      "info",
      "quote_cycle_freshness",
      "Quote cycle freshness measured",
      {
        market: snapshot.market,
        qualityGateMs,
        quoteComputeMs,
        recordQuoteMs,
        buildOrdersMs,
        reconcileMs,
        totalRefreshMs,
        bookAgeMsAtDecision,
        tickerAgeMsAtDecision,
        bookAgeMsAtSubmit,
        decisionMid,
        submitMid,
        midMoveDuringRefreshBps,
        targetOrderCount: targetOrders.length,
        activeOrderCount: activeOrders.length,
        skippedCount,
        orderManagerState,
        quoteCycleId,
      },
    );
    if (activeOrders.length === 0) {
      logger.info(
        `[application] RefreshQuotes | NO_ACTIVE_ORDERS | market=${snapshot.market} targetCount=${targetOrders.length} rejectedOrSkipped=true`,
      );
      await this.recordRuntimeHealth(
        "info",
        "quote_placement_no_active_orders",
        "No quote orders were submitted",
        { market: snapshot.market, targetCount: targetOrders.length },
      );
      return;
    }
    const bidOrder = activeOrders.find((entry) => entry.side === "buy")?.order;
    const askOrder = activeOrders.find((entry) => entry.side === "sell")?.order;
    logger.info(
      `[application] RefreshQuotes | ORDERS_SUBMITTED | market=${snapshot.market} bidOrderId=${bidOrder?.id ?? "none"} bidStatus=${bidOrder?.status ?? "skipped"} askOrderId=${askOrder?.id ?? "none"} askStatus=${askOrder?.status ?? "skipped"}`,
    );
  }

  private async guardedOrderRequest(order: {
    key: string;
    market: string;
    side: OrderSide;
    price: number;
    qty: number;
    reduceOnly: boolean;
    timeInForce: "ALO" | "GTC" | "IOC";
    clientOrderId: string;
    intent: "quote" | "reduce";
    trendBps: number;
  }): Promise<ManagedOrderRequest | undefined> {
    const touchSnapshot = await this.marketFeed.getSnapshot();
    const { trendBps, ...request } = order;
    await this.metrics?.recordMarketSnapshot(touchSnapshot);
    const skipReason = quoteSkipReason(order, touchSnapshot);
    if (skipReason !== null) {
      const healthLevel = quoteSkipHealthLevel(skipReason);
      const logMessage = `[application] RefreshQuotes | QUOTE_SIDE_SKIPPED | market=${order.market} side=${order.side} intent=${order.intent} reason=${skipReason} trendBps=${trendBps.toFixed(4)} touchStalenessMs=${touchStalenessMs(touchSnapshot)}`;
      if (healthLevel === "warn") {
        logger.warn(logMessage);
      } else {
        logger.debug(logMessage);
      }
      await this.recordRuntimeHealth(
        healthLevel,
        "quote_side_skipped",
        "Skipped quote side before placement",
        {
          market: order.market,
          side: order.side,
          intent: order.intent,
          reason: skipReason,
          trendBps,
          touchStalenessMs: touchStalenessMs(touchSnapshot),
        },
      );
      return undefined;
    }
    return {
      ...request,
      price: guardedLimitPrice(
        order.side,
        order.price,
        order.timeInForce,
        order.reduceOnly,
        touchSnapshot,
        trendBps,
      ),
    };
  }
}

function quoteBuildSummary(input: {
  market: string;
  quoteCycleId: string;
  positionQty: number;
  quote: {
    policy: "ALO" | "GTC" | "IOC";
    bid: number;
    ask: number;
    bidSize: number;
    askSize: number;
  };
  levels: QuoteLevel[];
  quoteControls: QuoteControls;
  quoteQuality: QuoteSideQuality[];
  qualityGate: QuoteQualityGateConfig;
}) {
  const levels = input.levels.map((level) => ({
    level: level.level,
    bid: level.bid,
    ask: level.ask,
    bidSize: level.bidSize,
    askSize: level.askSize,
    bidIntent: level.bidIntent,
    askIntent: level.askIntent,
    bidControlReasons: level.bidControlReasons ?? [],
    askControlReasons: level.askControlReasons ?? [],
  }));
  return {
    market: input.market,
    quoteCycleId: input.quoteCycleId,
    positionQty: input.positionQty,
    policy: input.quote.policy,
    topLevel: {
      bid: input.quote.bid,
      ask: input.quote.ask,
      bidSize: input.quote.bidSize,
      askSize: input.quote.askSize,
    },
    qualityGate: {
      enabled: input.qualityGate.enabled,
      minAverageMarkoutBps: input.qualityGate.minAverageMarkoutBps,
      minSamples: input.qualityGate.minSamples,
      lookbackFills: input.qualityGate.lookbackFills,
      maxFillAgeMs: input.qualityGate.maxFillAgeMs,
      horizonsSec: input.qualityGate.horizonsSec,
    },
    quoteControls: input.quoteControls,
    quoteQuality: input.quoteQuality.map((entry) => ({
      side: entry.side,
      horizons: entry.horizons.map((horizon) => ({
        horizonSec: horizon.horizonSec,
        sampleCount: horizon.sampleCount,
        averageMarkoutBps: horizon.averageMarkoutBps,
      })),
    })),
    sideSummary: {
      bid: quoteSideSummary(levels, "bid"),
      ask: quoteSideSummary(levels, "ask"),
    },
    levels,
  };
}

function quoteSideSummary(
  levels: ReadonlyArray<{
    bidSize: number;
    askSize: number;
    bidIntent?: QuoteSideIntent;
    askIntent?: QuoteSideIntent;
    bidControlReasons: string[];
    askControlReasons: string[];
  }>,
  side: "bid" | "ask",
) {
  const sizeKey = side === "bid" ? "bidSize" : "askSize";
  const intentKey = side === "bid" ? "bidIntent" : "askIntent";
  const reasonsKey = side === "bid" ? "bidControlReasons" : "askControlReasons";
  const intents = {
    open_quote: 0,
    reduce_inventory: 0,
    disabled: 0,
    unspecified: 0,
  };
  let zeroSizeCount = 0;
  const controlReasons = new Set<string>();
  for (const level of levels) {
    const intent = level[intentKey] ?? "unspecified";
    intents[intent] += 1;
    if (level[sizeKey] <= 0) {
      zeroSizeCount += 1;
    }
    for (const reason of level[reasonsKey]) {
      controlReasons.add(reason);
    }
  }
  return {
    intents,
    zeroSizeCount,
    submitEligibleCount: levels.filter((level) =>
      shouldSubmitSide(level[sizeKey], level[intentKey]),
    ).length,
    controlReasons: [...controlReasons],
  };
}

function formatReasonTags(reasons: ReadonlyArray<string> | undefined): string {
  if (reasons === undefined || reasons.length === 0) {
    return "none";
  }
  return reasons.join("|");
}

function quoteLevels(quote: {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidIntent?: QuoteSideIntent;
  askIntent?: QuoteSideIntent;
  levels?: QuoteLevel[];
}): QuoteLevel[] {
  return (
    quote.levels ?? [
      {
        level: 0,
        halfSpreadBps: 0,
        bid: quote.bid,
        ask: quote.ask,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        bidIntent: "bidIntent" in quote ? quote.bidIntent : undefined,
        askIntent: "askIntent" in quote ? quote.askIntent : undefined,
      },
    ]
  );
}

function shouldSubmitSide(size: number, intent: QuoteSideIntent | undefined): boolean {
  return size > 0 && intent !== "disabled";
}

function orderIntent(intent: QuoteSideIntent | undefined): "quote" | "reduce" {
  return intent === "reduce_inventory" ? "reduce" : "quote";
}

function quoteSkipReason(
  order: {
    side: OrderSide;
    intent: "quote" | "reduce";
    timeInForce: "ALO" | "GTC" | "IOC";
    trendBps: number;
  },
  snapshot: MarketSnapshot,
): string | null {
  if (order.intent !== "quote") {
    return null;
  }
  if (isStaleEpochSnapshot(snapshot)) {
    return "stale_touch";
  }
  if (order.side === "buy" && order.trendBps <= -OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS) {
    return "downtrend_open_bid";
  }
  if (order.side === "sell" && order.trendBps >= OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS) {
    return "uptrend_open_ask";
  }
  return null;
}

function quoteSkipHealthLevel(reason: string): "info" | "warn" {
  return reason === "stale_touch" ? "warn" : "info";
}

function isStaleEpochSnapshot(snapshot: MarketSnapshot): boolean {
  const touchTimestamp = snapshot.bookUpdatedAt ?? snapshot.timestamp;
  if (snapshot.bookUpdatedAt === undefined && isCandleSnapshot(snapshot)) {
    return false;
  }
  return (
    touchTimestamp >= EPOCH_MS_LOWER_BOUND &&
    touchStalenessMs(snapshot) > MAX_OPEN_QUOTE_TOUCH_STALENESS_MS
  );
}

function isCandleSnapshot(snapshot: MarketSnapshot): boolean {
  return (
    snapshot.open !== undefined &&
    snapshot.high !== undefined &&
    snapshot.low !== undefined &&
    snapshot.close !== undefined
  );
}

function touchStalenessMs(snapshot: MarketSnapshot): number {
  return Math.max(0, Date.now() - (snapshot.bookUpdatedAt ?? snapshot.timestamp));
}

function guardedLimitPrice(
  side: OrderSide,
  price: number,
  policy: "ALO" | "GTC" | "IOC",
  reduceOnly: boolean,
  snapshot: MarketSnapshot,
  trendBps: number,
): number {
  if (policy === "IOC") {
    return price;
  }

  if (policy === "ALO") {
    return side === "buy" ? Math.min(price, snapshot.bestBid) : Math.max(price, snapshot.bestAsk);
  }

  const currentMid = midPrice(snapshot);
  const passiveMarginBps = reduceOnly
    ? REDUCE_PASSIVE_TOUCH_MARGIN_BPS
    : NORMAL_PASSIVE_TOUCH_MARGIN_BPS;
  const momentumGuardBps =
    Math.min(Math.abs(trendBps) * MOMENTUM_GUARD_MULTIPLIER, MAX_MOMENTUM_GUARD_BPS) / 10_000;
  if (side === "buy") {
    const passiveBid = snapshot.bestBid * (1 - passiveMarginBps / 10_000);
    const guardedPrice = Math.min(price, passiveBid);
    if (trendBps < -MOMENTUM_GUARD_THRESHOLD_BPS) {
      return guardedPrice - currentMid * momentumGuardBps;
    }
    return guardedPrice;
  }

  const passiveAsk = snapshot.bestAsk * (1 + passiveMarginBps / 10_000);
  const guardedPrice = Math.max(price, passiveAsk);
  if (trendBps > MOMENTUM_GUARD_THRESHOLD_BPS) {
    return guardedPrice + currentMid * momentumGuardBps;
  }
  return guardedPrice;
}

function midPrice(snapshot: MarketSnapshot): number {
  return (snapshot.bestBid + snapshot.bestAsk) / 2;
}
