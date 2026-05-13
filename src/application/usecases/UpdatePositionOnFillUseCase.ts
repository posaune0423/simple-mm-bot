import type { Fill } from "../../domain/types/Fill.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { logger } from "../../utils/logger.ts";

export class UpdatePositionOnFillUseCase {
  constructor(private readonly positionRepository: IPositionRepository) {}

  async execute(fill: Fill): Promise<void> {
    logger.debug(
      `[application] UpdatePositionOnFill | FILL_POSITION_UPDATE_RECEIVED | venue=${fill.venue} market=${fill.market} fillId=${fill.id} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
    );
    await this.positionRepository.update(fill);
    logger.debug(
      `[application] UpdatePositionOnFill | FILL_POSITION_UPDATE_COMPLETED | fillId=${fill.id}`,
    );
  }
}
