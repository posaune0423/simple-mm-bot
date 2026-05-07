import { randomUUID } from "node:crypto";

import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway, PlacedOrder } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import type { Position } from "../../domain/entities/Position.ts";
import { isFlatPositionQty } from "../../domain/entities/Position.ts";
import { logger } from "../../utils/logger.ts";

const closeMaxAttempts = 30;
const forceCloseOffsetsBps = [50, 100, 200, 500] as const;
type CloseSide = "buy" | "sell";
type CloseAttempt = {
  attempt: number;
  side: CloseSide;
  qty: number;
};
type CloseResult = "filled" | "not_filled" | "fallback";

function normalizeClosePrice(price: number): number {
  return Number(price.toFixed(8));
}

function closePriceOffsetBps(attempt: number): number {
  return forceCloseOffsetsBps[Math.min(attempt - 1, forceCloseOffsetsBps.length - 1)] ?? 500;
}

function closePrice(bestBid: number, bestAsk: number, side: CloseSide, attempt: number): number {
  const offset = closePriceOffsetBps(attempt) / 10_000;
  return normalizeClosePrice(side === "sell" ? bestBid * (1 - offset) : bestAsk * (1 + offset));
}

export class ClosePositionUseCase {
  private useMarketClose = true;

  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly marketFeed: IMarketFeed,
    private readonly market: string,
    private readonly postCloseSyncDelaysMs: readonly number[] = [0, 250, 750],
    private readonly closeRetryDelayMs = 1_000,
  ) {}

  private async currentPosition(): Promise<Position> {
    await this.orderGateway.syncFills?.().catch((error) => {
      logger.warn(`close_position.sync_fills_failed market=${this.market} error=${String(error)}`);
    });

    if (!this.orderGateway.getPosition) {
      return await this.positionRepository.get();
    }

    return await this.orderGateway.getPosition().catch(async (error) => {
      logger.warn(
        `close_position.live_position_failed market=${this.market} error=${String(error)}`,
      );
      return await this.positionRepository.get();
    });
  }

  private async refreshPosition(): Promise<Position> {
    const position = await this.currentPosition();
    await this.positionRepository.set(position);
    return position;
  }

  private async syncFillsAfterClose(): Promise<void> {
    for (const delayMs of this.postCloseSyncDelaysMs) {
      if (delayMs > 0) {
        await Bun.sleep(delayMs);
      }
      await this.orderGateway.syncFills?.().catch((error) => {
        logger.warn(
          `close_position.post_close_sync_fills_failed market=${this.market} error=${String(error)}`,
        );
      });
    }
  }

  private closeAttempt(position: Position, attempt: number): CloseAttempt {
    return {
      attempt,
      side: position.qty > 0 ? "sell" : "buy",
      qty: Math.abs(position.qty),
    };
  }

  async execute(): Promise<void> {
    let lastStatus = "unknown";
    let lastSide = "unknown";
    let lastQty = 0;
    let fallbackAttempt = 1;

    for (let attempt = 1; attempt <= closeMaxAttempts; attempt += 1) {
      const position = await this.refreshPosition();
      if (isFlatPositionQty(position.qty)) {
        return;
      }

      const closeAttempt = this.closeAttempt(position, attempt);
      lastSide = closeAttempt.side;
      lastQty = closeAttempt.qty;

      if (this.useMarketClose) {
        const result = await this.placeMarketClose(closeAttempt, (status) => {
          lastStatus = status;
        });
        if (result === "filled") {
          await this.syncFillsAfterClose();
          return;
        }
        if (result === "not_filled") {
          await this.waitBeforeRetry();
          continue;
        }
      }

      const result = await this.placeLimitClose(closeAttempt, fallbackAttempt, (status) => {
        lastStatus = status;
      });
      fallbackAttempt += 1;
      if (result === "filled") {
        await this.syncFillsAfterClose();
        return;
      }
      await this.waitBeforeRetry();
    }

    throw new Error(
      `Close position order did not fill after ${closeMaxAttempts} attempts: market=${this.market} side=${lastSide} qty=${lastQty} status=${lastStatus}`,
    );
  }

  private async placeMarketClose(
    closeAttempt: CloseAttempt,
    recordStatus: (status: string) => void,
  ): Promise<CloseResult> {
    const { attempt, side, qty } = closeAttempt;
    logger.info(
      `close_position.order_submitted market=${this.market} side=${side} qty=${qty} price=market attempt=${attempt}/${closeMaxAttempts} forceClose=true`,
    );

    const placed = await this.orderGateway
      .place({
        market: this.market,
        side,
        qty,
        reduceOnly: true,
        timeInForce: "IOC",
        clientOrderId: randomUUID(),
        intent: "close",
      })
      .catch((err) => {
        const error = String(err);
        recordStatus(`error: ${error}`);
        if (error.includes("order.price is required")) {
          this.useMarketClose = false;
          return "fallback" as const;
        }
        logger.warn(
          `close_position.order_failed market=${this.market} side=${side} qty=${qty} price=market error=${error} attempt=${attempt}/${closeMaxAttempts}`,
        );
        return undefined;
      });

    if (placed === "fallback") {
      return "fallback";
    }
    return this.recordPlacedResult(placed, closeAttempt, recordStatus);
  }

  private async placeLimitClose(
    closeAttempt: CloseAttempt,
    fallbackAttempt: number,
    recordStatus: (status: string) => void,
  ): Promise<CloseResult> {
    const { attempt, side, qty } = closeAttempt;
    const snapshot = await this.marketFeed.getSnapshot();
    const offsetBps = closePriceOffsetBps(fallbackAttempt);
    const price = closePrice(snapshot.bestBid, snapshot.bestAsk, side, fallbackAttempt);

    logger.info(
      `close_position.order_submitted market=${this.market} side=${side} qty=${qty} price=${price} offsetBps=${offsetBps} attempt=${attempt}/${closeMaxAttempts} forceClose=true fallback=limit`,
    );

    const placed = await this.orderGateway
      .place({
        market: this.market,
        side,
        price,
        qty,
        reduceOnly: true,
        timeInForce: "IOC",
        clientOrderId: randomUUID(),
        intent: "close",
      })
      .catch((err) => {
        recordStatus(`error: ${String(err)}`);
        logger.warn(
          `close_position.order_failed market=${this.market} side=${side} qty=${qty} price=${price} offsetBps=${offsetBps} error=${String(err)} attempt=${attempt}/${closeMaxAttempts}`,
        );
        return undefined;
      });

    return this.recordPlacedResult(placed, closeAttempt, recordStatus);
  }

  private recordPlacedResult(
    placed: PlacedOrder | undefined,
    closeAttempt: CloseAttempt,
    recordStatus: (status: string) => void,
  ): CloseResult {
    if (placed?.status === "filled") {
      return "filled";
    }
    if (placed !== undefined) {
      recordStatus(placed.status);
      logger.warn(
        `close_position.order_not_filled market=${this.market} side=${closeAttempt.side} qty=${closeAttempt.qty} status=${placed.status} attempt=${closeAttempt.attempt}/${closeMaxAttempts}`,
      );
    }
    return "not_filled";
  }

  private async waitBeforeRetry(): Promise<void> {
    if (this.closeRetryDelayMs > 0) {
      await Bun.sleep(this.closeRetryDelayMs);
    }
  }
}
