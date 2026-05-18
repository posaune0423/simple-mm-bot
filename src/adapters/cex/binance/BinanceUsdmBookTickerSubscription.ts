import { BaseJsonWebSocketSubscription } from "../BaseJsonWebSocketSubscription.ts";
import type { ExternalSubscriptionParams } from "../ExternalMarketSubscription.ts";
import { normalizeBinanceUsdmBookTicker } from "./BinanceUsdmNormalizer.ts";

export class BinanceUsdmBookTickerSubscription extends BaseJsonWebSocketSubscription {
  constructor(params: ExternalSubscriptionParams) {
    super(
      "binance_usdm",
      params.symbol,
      `${params.wsUrl.replace(/\/$/, "")}/ws/${params.symbol.toLowerCase()}@bookTicker`,
      params.reconnectDelayMs,
    );
  }

  protected subscriptionPayload(): string | undefined {
    return undefined;
  }

  protected normalizeMessage(payload: unknown) {
    return normalizeBinanceUsdmBookTicker(
      payload as Parameters<typeof normalizeBinanceUsdmBookTicker>[0],
    );
  }
}
