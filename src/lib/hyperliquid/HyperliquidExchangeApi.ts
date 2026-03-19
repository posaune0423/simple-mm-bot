import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { detectTestnet } from "./detectTestnet.ts";
import type { CancelOrderParams, PlaceOrderParams } from "./types.ts";

export class HyperliquidExchangeApi {
  private readonly client: ExchangeClient;
  readonly address: string;

  constructor(params: { httpUrl: string; privateKey: string }) {
    const normalized = params.privateKey.startsWith("0x")
      ? params.privateKey
      : `0x${params.privateKey}`;
    const wallet = privateKeyToAccount(normalized as Hex);
    this.client = new ExchangeClient({
      transport: new HttpTransport({
        apiUrl: params.httpUrl,
        isTestnet: detectTestnet(params.httpUrl),
      }),
      wallet,
    });
    this.address = wallet.address;
  }

  async placeOrders(orders: PlaceOrderParams[]): Promise<void> {
    await this.client.order({
      orders: orders.map((o) => ({
        a: o.asset,
        b: o.isBuy,
        p: o.price,
        s: o.size,
        r: o.reduceOnly,
        t: { limit: { tif: o.timeInForce } },
      })),
      grouping: "na",
    });
  }

  async cancelOrders(cancels: CancelOrderParams[]): Promise<void> {
    if (cancels.length === 0) return;
    await this.client.cancel({
      cancels: cancels.map((c) => ({ a: c.asset, o: c.oid })),
    });
  }
}
