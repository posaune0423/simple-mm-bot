import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";
import { retryTransientBulk } from "../../utils/transientBulk.ts";

interface InitializePositionOptions {
  retryAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class InitializePositionUseCase {
  constructor(
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly options: InitializePositionOptions = {},
  ) {}

  async execute(): Promise<void> {
    if (this.orderGateway.getPosition === undefined) {
      return;
    }

    const position = await retryTransientBulk(
      async () => this.orderGateway.getPosition?.() ?? noPosition(),
      {
        attempts: this.options.retryAttempts ?? 1,
        delayMs: this.options.retryDelayMs ?? 1_000,
        sleep: this.options.sleep,
        onRetry: (error, attempt, attempts) => {
          logger.warn(
            `initialize_position.transient_retry attempt=${attempt}/${attempts} error=${stringifyError(error)}`,
          );
        },
      },
    );
    await this.positionRepository.set(position);
    logger.info(
      `initialize_position.seeded qty=${position.qty} avgEntry=${position.avgEntry} unrealizedPnl=${position.unrealizedPnl}`,
    );
  }
}

function noPosition(): never {
  throw new Error("Bulk getPosition disappeared during initialization");
}
