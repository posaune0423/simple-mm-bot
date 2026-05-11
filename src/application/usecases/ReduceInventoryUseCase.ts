import { randomUUID } from "node:crypto";

import type { Position } from "../../domain/entities/Position.ts";
import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway, OrderRequest, PlacedOrder } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

const reduceFallbackOffsetBps = 50;
const FAVORABLE_REDUCE_DEFER_THRESHOLD_BPS = 0.1;

interface ReduceInventoryOptions {
  reduceTriggerQty?: number;
  reduceTargetQty?: number;
  maxUnrealizedLossUsd?: number;
  maxAdverseMoveBps?: number;
  maxConsecutiveReduceFailures?: number;
}

export class ReduceInventoryUseCase {
  private consecutiveReduceFailures = 0;
  private previousReduceMidPrice: number | undefined;

  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly marketFeed: IMarketFeed,
    private readonly maxPositionQty: number,
    private readonly market: string,
    private readonly options: ReduceInventoryOptions = {},
  ) {}

  async executeIfNeeded(): Promise<boolean> {
    let position = await this.positionRepository.get();
    let absPositionQty = Math.abs(position.qty);
    const reduceTriggerQty = this.options.reduceTriggerQty ?? this.maxPositionQty;
    const reduceTargetQty = this.options.reduceTargetQty ?? this.maxPositionQty;
    let lossStop = exceededUnrealizedLoss(position.unrealizedPnl, this.options);
    if (
      absPositionQty <= reduceTriggerQty &&
      !lossStop &&
      this.options.maxAdverseMoveBps === undefined
    ) {
      return false;
    }

    const snapshot = await this.marketFeed.getSnapshot();
    const trendBps = this.reduceTrendBps(snapshot);
    const adverseStop = exceededAdverseMove(
      position.qty,
      position.avgEntry,
      snapshot.markPrice,
      this.options,
    );
    if (absPositionQty <= reduceTriggerQty && !lossStop && !adverseStop) {
      this.rememberReduceSnapshot(snapshot);
      return false;
    }

    position = await this.refreshLivePosition(position);
    absPositionQty = Math.abs(position.qty);
    lossStop = exceededUnrealizedLoss(position.unrealizedPnl, this.options);
    if (absPositionQty <= reduceTriggerQty && !lossStop && !adverseStop) {
      this.rememberReduceSnapshot(snapshot);
      return false;
    }

    const side: "buy" | "sell" = position.qty > 0 ? "sell" : "buy";
    const qty = Math.max(0, absPositionQty - reduceTargetQty);
    if (qty <= 0) {
      this.rememberReduceSnapshot(snapshot);
      return false;
    }
    if (
      shouldDeferFavorableReduce({
        side,
        absPositionQty,
        maxPositionQty: this.maxPositionQty,
        trendBps,
        lossStop,
        adverseStop,
      })
    ) {
      logger.warn(
        `reduce_inventory.favorable_reduce_deferred market=${this.market} side=${side} qty=${qty} trendBps=${trendBps.toFixed(4)} positionQty=${position.qty} reduceTriggerQty=${reduceTriggerQty} maxPositionQty=${this.maxPositionQty}`,
      );
      this.rememberReduceSnapshot(snapshot);
      return false;
    }

    await this.orderGateway.cancelAll();
    const marketOrderRequest = {
      market: this.market,
      side,
      qty,
      reduceOnly: true,
      timeInForce: "IOC" as const,
      clientOrderId: randomUUID(),
      intent: "reduce" as const,
    };

    const marketPlaced = await this.placeReduceOrder(marketOrderRequest, "market");
    if (this.isReduceAccepted(marketPlaced)) {
      this.consecutiveReduceFailures = 0;
      this.logReduceSubmitted(side, qty, "market", reduceTriggerQty, reduceTargetQty);
      this.rememberReduceSnapshot(snapshot);
      return true;
    }

    const fallbackPrice = aggressiveReducePrice(snapshot.bestBid, snapshot.bestAsk, side);
    if (marketPlaced !== null) {
      logger.warn(
        `reduce_inventory.market_reduce_not_filled market=${this.market} side=${side} qty=${qty} status=${marketPlaced.status} fallbackPrice=${fallbackPrice}`,
      );
    }
    const fallbackOrderRequest = {
      ...marketOrderRequest,
      price: fallbackPrice,
      clientOrderId: randomUUID(),
    };
    const fallbackPlaced = await this.placeReduceOrder(fallbackOrderRequest, "fallback");
    this.rememberReduceSnapshot(snapshot);
    if (fallbackPlaced === null) {
      return true;
    }
    this.recordReduceResult(fallbackPlaced);
    this.logReduceSubmitted(side, qty, String(fallbackPrice), reduceTriggerQty, reduceTargetQty);
    return true;
  }

  private async refreshLivePosition(fallback: Position): Promise<Position> {
    await this.orderGateway.syncFills?.().catch((error) => {
      logger.warn(
        `reduce_inventory.sync_fills_failed market=${this.market} error=${stringifyError(error)}`,
      );
    });
    if (!this.orderGateway.getPosition) {
      return fallback;
    }

    return await this.orderGateway.getPosition().then(
      async (position) => {
        await this.positionRepository.set(position);
        return position;
      },
      (error) => {
        logger.warn(
          `reduce_inventory.live_position_failed market=${this.market} error=${stringifyError(error)}`,
        );
        return fallback;
      },
    );
  }

  private async placeReduceOrder(
    orderRequest: OrderRequest,
    phase: "market" | "fallback",
  ): Promise<PlacedOrder | null> {
    return await this.orderGateway.place(orderRequest).catch((error) => {
      if (phase === "fallback") {
        this.recordReduceFailure("submit_error", stringifyError(error));
      } else {
        logger.warn(
          `reduce_inventory.market_reduce_submit_failed market=${this.market} side=${orderRequest.side} qty=${orderRequest.qty} error=${stringifyError(error)}`,
        );
      }
      return null;
    });
  }

  private isReduceAccepted(order: PlacedOrder | null): boolean {
    return (
      order?.status === "open" || order?.status === "filled" || order?.status === "partially_filled"
    );
  }

  private recordReduceResult(order: PlacedOrder): void {
    if (
      order.status === "open" ||
      order.status === "filled" ||
      order.status === "partially_filled"
    ) {
      this.consecutiveReduceFailures = 0;
      return;
    }

    this.recordReduceFailure(order.status, order.id);
  }

  private logReduceSubmitted(
    side: "buy" | "sell",
    qty: number,
    price: string,
    reduceTriggerQty: number,
    reduceTargetQty: number,
  ): void {
    logger.info(
      `reduce_inventory.order_submitted market=${this.market} side=${side} qty=${qty} price=${price} reduceTriggerQty=${reduceTriggerQty} reduceTargetQty=${reduceTargetQty} maxPositionQty=${this.maxPositionQty}`,
    );
  }

  private recordReduceFailure(status: string, detail: string): void {
    this.consecutiveReduceFailures += 1;
    const maxFailures = this.options.maxConsecutiveReduceFailures ?? 3;
    logger.warn(
      `reduce_inventory.order_failed market=${this.market} status=${status} detail=${detail} consecutiveFailures=${this.consecutiveReduceFailures} maxFailures=${maxFailures}`,
    );
    if (this.consecutiveReduceFailures >= maxFailures) {
      throw new Error(
        `Hard inventory reduce failed closed after ${this.consecutiveReduceFailures} consecutive failures`,
      );
    }
  }

  private reduceTrendBps(snapshot: { bestBid: number; bestAsk: number }): number {
    const mid = midPrice(snapshot);
    if (this.previousReduceMidPrice === undefined || this.previousReduceMidPrice <= 0) {
      return 0;
    }
    return ((mid - this.previousReduceMidPrice) / this.previousReduceMidPrice) * 10_000;
  }

  private rememberReduceSnapshot(snapshot: { bestBid: number; bestAsk: number }): void {
    this.previousReduceMidPrice = midPrice(snapshot);
  }
}

function exceededUnrealizedLoss(unrealizedPnl: number, options: ReduceInventoryOptions): boolean {
  return (
    options.maxUnrealizedLossUsd !== undefined && unrealizedPnl <= -options.maxUnrealizedLossUsd
  );
}

function exceededAdverseMove(
  positionQty: number,
  avgEntry: number,
  markPrice: number,
  options: ReduceInventoryOptions,
): boolean {
  if (options.maxAdverseMoveBps === undefined || avgEntry <= 0 || positionQty === 0) {
    return false;
  }

  const moveBps =
    positionQty > 0
      ? ((avgEntry - markPrice) / avgEntry) * 10_000
      : ((markPrice - avgEntry) / avgEntry) * 10_000;
  return moveBps >= options.maxAdverseMoveBps;
}

function aggressiveReducePrice(bestBid: number, bestAsk: number, side: "buy" | "sell"): number {
  const offset = reduceFallbackOffsetBps / 10_000;
  const price = side === "sell" ? bestBid * (1 - offset) : bestAsk * (1 + offset);
  return Number(price.toFixed(8));
}

function shouldDeferFavorableReduce(input: {
  side: "buy" | "sell";
  absPositionQty: number;
  maxPositionQty: number;
  trendBps: number;
  lossStop: boolean;
  adverseStop: boolean;
}): boolean {
  if (input.lossStop || input.adverseStop || input.absPositionQty > input.maxPositionQty) {
    return false;
  }
  if (input.side === "buy") {
    return input.trendBps <= -FAVORABLE_REDUCE_DEFER_THRESHOLD_BPS;
  }
  return input.trendBps >= FAVORABLE_REDUCE_DEFER_THRESHOLD_BPS;
}

function midPrice(snapshot: { bestBid: number; bestAsk: number }): number {
  return (snapshot.bestBid + snapshot.bestAsk) / 2;
}
