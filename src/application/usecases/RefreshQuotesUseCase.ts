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
import type { MetricsRecorder } from "../MetricsRecorder.ts";
import { OrderManager, type ManagedOrderRequest } from "../OrderManager.ts";
import { logger } from "../../utils/logger.ts";

const NORMAL_PASSIVE_TOUCH_MARGIN_BPS = 0.25;
const REDUCE_PASSIVE_TOUCH_MARGIN_BPS = 0.05;
const MAX_OPEN_QUOTE_TOUCH_STALENESS_MS = 3_000;
const EPOCH_MS_LOWER_BOUND = 1_000_000_000_000;
const MOMENTUM_GUARD_THRESHOLD_BPS = 0.05;
const OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS = 2;
const MOMENTUM_GUARD_MULTIPLIER = 1;
const MAX_MOMENTUM_GUARD_BPS = 8;

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
  ) {
    this.orderManager = new OrderManager(orderGateway);
    this.qualityGate = qualityGate;
    this.quoteControlPolicy = new QuoteControlPolicy(qualityGate);
  }

  private readonly qualityGate: QuoteQualityGateConfig;
  private readonly quoteControlPolicy: QuoteControlPolicy;

  async execute(): Promise<void> {
    await this.marketFeed.getSnapshot();
    const [snapshot, position] = await Promise.all([
      this.marketFeed.getSnapshot(),
      this.positionRepository.get(),
    ]);

    const quoteQuality =
      !this.qualityGate.enabled || this.quoteQualityRepository === undefined
        ? []
        : await this.quoteQualityRepository.getRecentSideQuality({
            market: snapshot.market,
            lookbackFills: this.qualityGate.lookbackFills ?? 100,
            horizonsSec: this.qualityGate.horizonsSec,
          });
    const quoteControls = this.quoteControlPolicy.controlsFor(quoteQuality);
    const quote = this.quoteEngine.compute(snapshot, position, quoteControls);
    logger.info(
      `refresh_quotes.quote_created market=${snapshot.market} bid=${quote.bid} ask=${quote.ask} bidSize=${quote.bidSize} askSize=${quote.askSize} policy=${quote.policy} positionQty=${position.qty}`,
    );
    await this.metrics?.recordQuote(snapshot, position.qty, quote);
    const trendSnapshot = await this.marketFeed.getSnapshot();
    const placementMid = midPrice(trendSnapshot);
    const trendBps =
      this.previousPlacementMid !== null && this.previousPlacementMid > 0
        ? ((placementMid - this.previousPlacementMid) / this.previousPlacementMid) * 10_000
        : 0;
    this.previousPlacementMid = placementMid;
    const quoteCycleId = randomUUID();
    const targetOrders: ManagedOrderRequest[] = [];
    for (const level of quoteLevels(quote)) {
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
        }
      }
    }
    const activeOrders = await this.orderManager.reconcile(targetOrders);
    if (activeOrders.length === 0) {
      logger.warn(
        `refresh_quotes.no_active_orders market=${snapshot.market} targetCount=${targetOrders.length} rejectedOrSkipped=true`,
      );
      await this.metrics?.recordRuntimeHealth(
        "warn",
        "quote_placement_no_active_orders",
        "No quote orders were submitted",
        { market: snapshot.market, targetCount: targetOrders.length },
      );
      return;
    }
    const bidOrder = activeOrders.find((entry) => entry.side === "buy")?.order;
    const askOrder = activeOrders.find((entry) => entry.side === "sell")?.order;
    logger.info(
      `refresh_quotes.orders_submitted market=${snapshot.market} bidOrderId=${bidOrder?.id ?? "none"} bidStatus=${bidOrder?.status ?? "skipped"} askOrderId=${askOrder?.id ?? "none"} askStatus=${askOrder?.status ?? "skipped"}`,
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
      logger.warn(
        `refresh_quotes.quote_side_skipped market=${order.market} side=${order.side} intent=${order.intent} reason=${skipReason} trendBps=${trendBps.toFixed(4)} touchStalenessMs=${touchStalenessMs(touchSnapshot)}`,
      );
      await this.metrics?.recordRuntimeHealth(
        "warn",
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
  if (order.timeInForce !== "GTC") {
    return null;
  }
  if (isStaleEpochSnapshot(snapshot)) {
    return "stale_touch";
  }
  if (order.side === "buy" && order.trendBps <= -OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS) {
    return order.intent === "reduce" ? "downtrend_reduce_bid" : "downtrend_open_bid";
  }
  if (order.side === "sell" && order.trendBps >= OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS) {
    return order.intent === "reduce" ? "uptrend_reduce_ask" : "uptrend_open_ask";
  }
  return null;
}

function isStaleEpochSnapshot(snapshot: MarketSnapshot): boolean {
  return (
    snapshot.timestamp >= EPOCH_MS_LOWER_BOUND &&
    !isCandleSnapshot(snapshot) &&
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
  return Math.max(0, Date.now() - snapshot.timestamp);
}

function guardedLimitPrice(
  side: OrderSide,
  price: number,
  policy: "ALO" | "GTC" | "IOC",
  reduceOnly: boolean,
  snapshot: MarketSnapshot,
  trendBps: number,
): number {
  if (policy !== "GTC") {
    return price;
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
