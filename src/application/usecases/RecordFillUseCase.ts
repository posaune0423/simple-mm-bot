import type { Fill } from "../../domain/entities/Fill.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import type { ITradeRepository } from "../../domain/ports/ITradeRepository.ts";

export class RecordFillUseCase {
  constructor(
    private readonly tradeRepository: ITradeRepository,
    private readonly positionRepository: IPositionRepository,
  ) {}

  async execute(fill: Fill): Promise<void> {
    await this.tradeRepository.save(fill);
    await this.positionRepository.update(fill);
  }
}
