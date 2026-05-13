import type { Position } from "../../domain/types/Position.ts";
import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { logger } from "../../utils/logger.ts";

export interface PositionSyncResult {
  synced: boolean;
  previous: Position;
  current: Position;
  deltaQty: number;
}

export class SyncPositionUseCase {
  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
  ) {}

  async execute(): Promise<PositionSyncResult> {
    const previous = await this.positionRepository.get();
    if (this.orderGateway.getPosition === undefined) {
      return { synced: false, previous, current: previous, deltaQty: 0 };
    }

    const current = await this.orderGateway.getPosition();
    await this.positionRepository.set(current);
    const deltaQty = current.qty - previous.qty;
    if (deltaQty !== 0) {
      logger.info(
        `[application] SyncPosition | CORRECTED | previousQty=${previous.qty} currentQty=${current.qty} deltaQty=${deltaQty}`,
      );
    }
    return { synced: true, previous, current, deltaQty };
  }
}
