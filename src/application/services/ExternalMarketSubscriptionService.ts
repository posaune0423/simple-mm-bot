import type { IExternalMarketSubscription } from "../../domain/ports/IExternalMarketSubscription.ts";
import type { IExternalMarketTopOfBookWriter } from "../../domain/ports/IExternalMarketTopOfBookStore.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

export class ExternalMarketSubscriptionService {
  private started = false;

  constructor(
    private readonly subscriptions: readonly IExternalMarketSubscription[],
    private readonly writer: IExternalMarketTopOfBookWriter,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
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
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    for (const subscription of this.subscriptions) {
      try {
        subscription.stop();
      } catch (error) {
        logger.warn(
          `[application] ExternalMarketSubscriptionService | STOP_FAILED | venue=${subscription.venue} symbol=${subscription.symbol} error=${stringifyError(error)}`,
        );
      }
    }
  }
}
