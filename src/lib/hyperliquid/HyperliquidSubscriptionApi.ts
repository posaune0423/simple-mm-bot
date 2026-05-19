import { SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";

import { detectTestnet } from "./detectTestnet.ts";
import type { BookLevel, BookSnapshot, Unsubscribe } from "./types.ts";

function parseBookLevels(levels: Array<{ px: string; sz: string }>): BookLevel[] {
  return levels.map((l) => ({ price: Number(l.px), size: Number(l.sz) }));
}

export class HyperliquidSubscriptionApi {
  private readonly transport: WebSocketTransport;
  private readonly client: SubscriptionClient;

  constructor(params: { wsUrl: string; httpUrl: string }) {
    this.transport = new WebSocketTransport({
      url: params.wsUrl,
      isTestnet: detectTestnet(params.httpUrl),
    });
    this.client = new SubscriptionClient({
      transport: this.transport,
    });
  }

  async subscribeL2Book(
    coin: string,
    onUpdate: (book: BookSnapshot) => void,
  ): Promise<Unsubscribe> {
    const sub = await this.client.l2Book({ coin }, (raw) => {
      const [rawBids, rawAsks] = raw.levels;
      onUpdate({
        coin: raw.coin,
        time: raw.time,
        bids: parseBookLevels(rawBids),
        asks: parseBookLevels(rawAsks),
      });
    });
    return async () => sub.unsubscribe();
  }

  async subscribeAllMids(onUpdate: (mids: Record<string, number>) => void): Promise<Unsubscribe> {
    const sub = await this.client.allMids((raw) => {
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw.mids)) {
        result[key] = Number(value);
      }
      onUpdate(result);
    });
    return async () => sub.unsubscribe();
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
