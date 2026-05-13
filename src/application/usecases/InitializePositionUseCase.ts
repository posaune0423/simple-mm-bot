import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import { isRecoverableVenueError } from "../../domain/ports/RecoverableVenueError.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

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

    const position = await retryRecoverableVenue(
      async () => this.orderGateway.getPosition?.() ?? noPosition(),
      {
        attempts: this.options.retryAttempts ?? 1,
        delayMs: this.options.retryDelayMs ?? 1_000,
        sleep: this.options.sleep,
        onRetry: (error, attempt, attempts) => {
          logger.warn(
            `[application] InitializePosition | TRANSIENT_RETRY | attempt=${attempt}/${attempts} error=${stringifyError(error)}`,
          );
        },
      },
    );
    await this.positionRepository.set(position);
    logger.info(
      `[application] InitializePosition | SEEDED | qty=${position.qty} avgEntry=${position.avgEntry} unrealizedPnl=${position.unrealizedPnl}`,
    );
  }
}

async function retryRecoverableVenue<T>(
  operation: () => Promise<T>,
  options: {
    attempts: number;
    delayMs: number;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (error: unknown, attempt: number, attempts: number) => void;
  },
): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const sleep = options.sleep ?? Bun.sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRecoverableVenueError(error) || attempt === attempts) {
        throw error;
      }
      options.onRetry?.(error, attempt, attempts);
      await sleep(options.delayMs);
    }
  }

  throw lastError;
}

function noPosition(): never {
  throw new Error("Bulk getPosition disappeared during initialization");
}
