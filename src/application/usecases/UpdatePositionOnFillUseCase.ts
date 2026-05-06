import type { Fill } from "../../domain/entities/Fill.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { logger } from "../../utils/logger.ts";

export class UpdatePositionOnFillUseCase {
  constructor(private readonly positionRepository: IPositionRepository) {}

  async execute(fill: Fill): Promise<void> {
    logger.debug(
      `fill_position_update.received venue=${fill.venue} market=${fill.market} fillId=${fill.id} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
    );
    await this.positionRepository.update(fill);
    logger.debug(`fill_position_update.completed fillId=${fill.id}`);
  }
}
