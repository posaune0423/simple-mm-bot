import type { Fill } from "../../domain/entities/Fill.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import type { ITradeRepository } from "../../domain/ports/ITradeRepository.ts";
import { logger } from "../../utils/logger.ts";

export class RecordFillUseCase {
  constructor(
    private readonly tradeRepository: ITradeRepository,
    private readonly positionRepository: IPositionRepository,
  ) {}

  async execute(fill: Fill): Promise<void> {
    logger.debug(
      `record_fill.received venue=${fill.venue} market=${fill.market} fillId=${fill.id} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
    );
    await this.tradeRepository.save(fill);
    await this.positionRepository.update(fill);
    logger.debug(`record_fill.persisted fillId=${fill.id}`);
  }
}
