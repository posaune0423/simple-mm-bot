import { BaseJsonWebSocketSubscription } from "../BaseJsonWebSocketSubscription.ts";
import type { ExternalSubscriptionParams } from "../ExternalMarketSubscription.ts";
import { normalizeOkxBbo } from "./OkxNormalizer.ts";

export class OkxBboSubscription extends BaseJsonWebSocketSubscription {
  constructor(params: ExternalSubscriptionParams) {
    super("okx_swap", params.symbol, params.wsUrl, params.reconnectDelayMs);
  }

  protected subscriptionPayload(): string {
    return JSON.stringify({
      op: "subscribe",
      args: [{ channel: "bbo-tbt", instId: this.symbol }],
    });
  }

  protected normalizeMessage(payload: unknown) {
    return normalizeOkxBbo(payload as Parameters<typeof normalizeOkxBbo>[0]);
  }
}
