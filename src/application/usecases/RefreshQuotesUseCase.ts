import { randomUUID } from "node:crypto";

import type { QuoteEngine } from "../../domain/QuoteEngine.ts";
import type { OrderSide, QuoteLevel, QuoteSideIntent } from "../../domain/entities/Quote.ts";
import type { IMarketFeed, MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import type { MetricsRecorder } from "../MetricsRecorder.ts";
import { OrderManager, type ManagedOrderRequest } from "../OrderManager.ts";
import { logger } from "../../utils/logger.ts";

const BID_PASSIVE_TOUCH_MARGIN_BPS = 3;
const ASK_PASSIVE_TOUCH_MARGIN_BPS = 2.25;
const MOMENTUM_GUARD_THRESHOLD_BPS = 0.05;
const MOMENTUM_GUARD_MULTIPLIER = 4;
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
  ) {
    this.orderManager = new OrderManager(orderGateway);
  }

  async execute(): Promise<void> {
    await this.marketFeed.getSnapshot();
    const [snapshot, position] = await Promise.all([
      this.marketFeed.getSnapshot(),
      this.positionRepository.get(),
    ]);

    const quote = this.quoteEngine.compute(snapshot, position);
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
        targetOrders.push(
          await this.guardedOrderRequest({
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
          }),
        );
      }
      if (shouldSubmitSide(level.askSize, level.askIntent)) {
        targetOrders.push(
          await this.guardedOrderRequest({
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
          }),
        );
      }
    }
    const activeOrders = await this.orderManager.reconcile(targetOrders);
    if (activeOrders.length === 0) {
      throw new Error("No quote orders were submitted");
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
  }): Promise<ManagedOrderRequest> {
    const touchSnapshot = await this.marketFeed.getSnapshot();
    const { trendBps, ...request } = order;
    await this.metrics?.recordMarketSnapshot(touchSnapshot);
    return {
      ...request,
      price: guardedLimitPrice(order.side, order.price, order.timeInForce, touchSnapshot, trendBps),
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

function guardedLimitPrice(
  side: OrderSide,
  price: number,
  policy: "ALO" | "GTC" | "IOC",
  snapshot: MarketSnapshot,
  trendBps: number,
): number {
  if (policy !== "GTC") {
    return price;
  }

  const currentMid = midPrice(snapshot);
  const momentumGuardBps =
    Math.min(Math.abs(trendBps) * MOMENTUM_GUARD_MULTIPLIER, MAX_MOMENTUM_GUARD_BPS) / 10_000;
  if (side === "buy") {
    const passiveBid = snapshot.bestBid * (1 - BID_PASSIVE_TOUCH_MARGIN_BPS / 10_000);
    const guardedPrice = Math.min(price, passiveBid);
    if (trendBps < -MOMENTUM_GUARD_THRESHOLD_BPS) {
      return guardedPrice - currentMid * momentumGuardBps;
    }
    return guardedPrice;
  }

  const passiveAsk = snapshot.bestAsk * (1 + ASK_PASSIVE_TOUCH_MARGIN_BPS / 10_000);
  const guardedPrice = Math.max(price, passiveAsk);
  if (trendBps > MOMENTUM_GUARD_THRESHOLD_BPS) {
    return guardedPrice + currentMid * momentumGuardBps;
  }
  return guardedPrice;
}

function midPrice(snapshot: MarketSnapshot): number {
  return (snapshot.bestBid + snapshot.bestAsk) / 2;
}
