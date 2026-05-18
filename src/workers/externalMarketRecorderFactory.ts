import { buildExternalMarketSubscription } from "../adapters/cex/ExternalMarketSubscriptionFactory.ts";
import type { IExternalMarketSubscription } from "../domain/ports/IExternalMarketSubscription.ts";
import type { ExternalMarketRecorderConfig } from "./externalMarketRecorderConfig.ts";

export function buildExternalMarketRecorderSubscriptions(
  config: ExternalMarketRecorderConfig,
): IExternalMarketSubscription[] {
  return config.sources.map(buildExternalMarketSubscription);
}
