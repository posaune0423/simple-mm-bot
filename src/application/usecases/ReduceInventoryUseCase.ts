import { randomUUID } from "node:crypto";

import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { logger } from "../../utils/logger.ts";

interface ReduceInventoryOptions {
  reduceTriggerQty?: number;
  reduceTargetQty?: number;
  maxUnrealizedLossUsd?: number;
  maxAdverseMoveBps?: number;
}

export class ReduceInventoryUseCase {
  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly marketFeed: IMarketFeed,
    private readonly maxPositionQty: number,
    private readonly market: string,
    private readonly options: ReduceInventoryOptions = {},
  ) {}

  async executeIfNeeded(): Promise<boolean> {
    const position = await this.positionRepository.get();
    const absPositionQty = Math.abs(position.qty);
    const reduceTriggerQty = this.options.reduceTriggerQty ?? this.maxPositionQty;
    const reduceTargetQty = this.options.reduceTargetQty ?? this.maxPositionQty;
    const lossStop = exceededUnrealizedLoss(position.unrealizedPnl, this.options);
    if (
      absPositionQty <= reduceTriggerQty &&
      !lossStop &&
      this.options.maxAdverseMoveBps === undefined
    ) {
      return false;
    }

    const snapshot = await this.marketFeed.getSnapshot();
    const adverseStop = exceededAdverseMove(
      position.qty,
      position.avgEntry,
      snapshot.markPrice,
      this.options,
    );
    if (absPositionQty <= reduceTriggerQty && !lossStop && !adverseStop) {
      return false;
    }

    const side = position.qty > 0 ? "sell" : "buy";
    const qty = Math.max(0, absPositionQty - reduceTargetQty);
    if (qty <= 0) {
      return false;
    }
    const price = side === "sell" ? snapshot.bestBid : snapshot.bestAsk;

    if (absPositionQty >= this.maxPositionQty || lossStop || adverseStop) {
      await this.orderGateway.cancelAll();
    }
    await this.orderGateway.place({
      market: this.market,
      side,
      price,
      qty,
      reduceOnly: true,
      timeInForce: "IOC",
      clientOrderId: randomUUID(),
      intent: "reduce",
    });
    logger.info(
      `reduce_inventory.order_submitted market=${this.market} side=${side} qty=${qty} price=${price} reduceTriggerQty=${reduceTriggerQty} reduceTargetQty=${reduceTargetQty} maxPositionQty=${this.maxPositionQty}`,
    );
    return true;
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
