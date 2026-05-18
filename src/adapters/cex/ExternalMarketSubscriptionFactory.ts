import { match } from "ts-pattern";

import type {
  ExternalMarketSourceConfig,
  ExternalVenueId,
} from "../../domain/external-market/ExternalMarketTypes.ts";
import type { IExternalMarketSubscription } from "../../domain/ports/IExternalMarketSubscription.ts";
import { BinanceUsdmBookTickerSubscription } from "./binance/BinanceUsdmBookTickerSubscription.ts";
import { BybitOrderbook1Subscription } from "./bybit/BybitOrderbook1Subscription.ts";
import { OkxBboSubscription } from "./okx/OkxBboSubscription.ts";

export type ExternalMarketSubscriptionSourceConfig = ExternalMarketSourceConfig &
  Readonly<{
    wsUrl: string;
    reconnectDelayMs: number;
    channel: string;
  }>;

export function buildExternalMarketSubscription(
  source: ExternalMarketSubscriptionSourceConfig,
): IExternalMarketSubscription {
  return match<ExternalVenueId, IExternalMarketSubscription>(source.venue)
    .with(
      "binance_usdm",
      () =>
        new BinanceUsdmBookTickerSubscription({
          symbol: source.symbol,
          wsUrl: source.wsUrl,
          reconnectDelayMs: source.reconnectDelayMs,
        }),
    )
    .with(
      "okx_swap",
      () =>
        new OkxBboSubscription({
          symbol: source.symbol,
          wsUrl: source.wsUrl,
          reconnectDelayMs: source.reconnectDelayMs,
        }),
    )
    .with(
      "bybit_linear",
      () =>
        new BybitOrderbook1Subscription({
          symbol: source.symbol,
          wsUrl: source.wsUrl,
          reconnectDelayMs: source.reconnectDelayMs,
        }),
    )
    .exhaustive();
}
