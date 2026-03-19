import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";

export class ReduceInventoryUseCase {
  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly maxPositionQty: number,
    private readonly market: string,
  ) {}

  async executeIfNeeded(): Promise<boolean> {
    const position = await this.positionRepository.get();
    if (Math.abs(position.qty) <= this.maxPositionQty) {
      return false;
    }

    await this.orderGateway.place({
      market: this.market,
      side: position.qty > 0 ? "sell" : "buy",
      qty: Math.abs(position.qty) - this.maxPositionQty,
      reduceOnly: true,
      timeInForce: "IOC",
    });
    return true;
  }
}
