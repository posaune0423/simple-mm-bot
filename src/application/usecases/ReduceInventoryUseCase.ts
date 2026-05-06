import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { logger } from "../../utils/logger.ts";

export class ReduceInventoryUseCase {
  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly marketFeed: IMarketFeed,
    private readonly maxPositionQty: number,
    private readonly market: string,
  ) {}

  async executeIfNeeded(): Promise<boolean> {
    const position = await this.positionRepository.get();
    if (Math.abs(position.qty) <= this.maxPositionQty) {
      return false;
    }

    const snapshot = await this.marketFeed.getSnapshot();
    const side = position.qty > 0 ? "sell" : "buy";
    const qty = Math.abs(position.qty) - this.maxPositionQty;
    const price = side === "sell" ? snapshot.bestBid : snapshot.bestAsk;

    await this.orderGateway.place({
      market: this.market,
      side,
      price,
      qty,
      reduceOnly: true,
      timeInForce: "IOC",
    });
    logger.info(
      `reduce_inventory.order_submitted market=${this.market} side=${side} qty=${qty} price=${price} maxPositionQty=${this.maxPositionQty}`,
    );
    return true;
  }
}
