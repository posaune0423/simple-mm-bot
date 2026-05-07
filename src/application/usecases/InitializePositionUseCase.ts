import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { logger } from "../../utils/logger.ts";

export class InitializePositionUseCase {
  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
  ) {}

  async execute(): Promise<void> {
    if (this.orderGateway.getPosition === undefined) {
      return;
    }

    const position = await this.orderGateway.getPosition();
    await this.positionRepository.set(position);
    logger.info(
      `initialize_position.seeded qty=${position.qty} avgEntry=${position.avgEntry} unrealizedPnl=${position.unrealizedPnl}`,
    );
  }
}
