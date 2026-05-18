import type { IExternalMarketSubscription } from "../../domain/ports/IExternalMarketSubscription.ts";
import type { IExternalMarketTopOfBookWriter } from "../../domain/ports/IExternalMarketTopOfBookStore.ts";
import type { IFairValueProvider } from "../../domain/ports/IFairValueProvider.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

type ExternalMarketWarmup = Readonly<{
  provider: IFairValueProvider;
  timeoutMs?: number;
  pollIntervalMs?: number;
}>;

const DEFAULT_WARMUP_TIMEOUT_MS = 10_000;
const DEFAULT_WARMUP_POLL_INTERVAL_MS = 25;

export class ExternalMarketSubscriptionService {
  private started = false;

  constructor(
    private readonly subscriptions: readonly IExternalMarketSubscription[],
    private readonly writer: IExternalMarketTopOfBookWriter,
    private readonly warmup?: ExternalMarketWarmup,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    try {
      for (const subscription of this.subscriptions) {
        try {
          subscription.start({
            onTopOfBook: (update) => {
              this.writer.update(update);
            },
            onError: (error) => {
              logger.warn(
                `[application] ExternalMarketSubscriptionService | SUBSCRIPTION_ERROR | venue=${subscription.venue} symbol=${subscription.symbol} error=${stringifyError(error)}`,
              );
            },
          });
        } catch (error) {
          logger.warn(
            `[application] ExternalMarketSubscriptionService | START_FAILED | venue=${subscription.venue} symbol=${subscription.symbol} error=${stringifyError(error)}`,
          );
        }
      }
      await this.waitForWarmupIfConfigured();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    for (const subscription of this.subscriptions) {
      try {
        await subscription.stop();
      } catch (error) {
        logger.warn(
          `[application] ExternalMarketSubscriptionService | STOP_FAILED | venue=${subscription.venue} symbol=${subscription.symbol} error=${stringifyError(error)}`,
        );
      }
    }
  }

  private async waitForWarmupIfConfigured(): Promise<void> {
    if (this.warmup === undefined) {
      return;
    }

    const timeoutMs = this.warmup.timeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS;
    const pollIntervalMs = this.warmup.pollIntervalMs ?? DEFAULT_WARMUP_POLL_INTERVAL_MS;
    const startedAt = Date.now();
    logger.info(
      `[application] ExternalMarketSubscriptionService | WARMUP_STARTED | timeoutMs=${timeoutMs}`,
    );

    while (this.started && Date.now() - startedAt <= timeoutMs) {
      const snapshot = this.warmup.provider.getLatestFairValue(Date.now());
      if (snapshot.status !== "unavailable" && Number.isFinite(snapshot.fairMid)) {
        logger.info(
          `[application] ExternalMarketSubscriptionService | WARMUP_READY | status=${snapshot.status} used=${snapshot.used.length} maxAgeMs=${snapshot.maxAgeMs}`,
        );
        return;
      }
      await sleep(pollIntervalMs);
    }

    if (!this.started) {
      return;
    }
    throw new Error(`External fair value warmup timed out after ${timeoutMs}ms`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
