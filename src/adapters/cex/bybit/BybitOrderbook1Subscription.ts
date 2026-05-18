import { BaseJsonWebSocketSubscription } from "../BaseJsonWebSocketSubscription.ts";
import type { ExternalSubscriptionParams } from "../ExternalMarketSubscription.ts";
import { normalizeBybitOrderbook1 } from "./BybitNormalizer.ts";

export class BybitOrderbook1Subscription extends BaseJsonWebSocketSubscription {
  constructor(params: ExternalSubscriptionParams) {
    super("bybit_linear", params.symbol, params.wsUrl, params.reconnectDelayMs);
  }

  protected subscriptionPayload(): string {
    return JSON.stringify({
      op: "subscribe",
      args: [`orderbook.1.${this.symbol}`],
    });
  }

  protected normalizeMessage(payload: unknown) {
    return normalizeBybitOrderbook1(payload as Parameters<typeof normalizeBybitOrderbook1>[0]);
  }
}
