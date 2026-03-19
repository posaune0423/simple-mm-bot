import { randomUUID } from "node:crypto";

import type { HyperliquidExchangeApi } from "../../lib/hyperliquid/HyperliquidExchangeApi.ts";
import type { HyperliquidInfoApi } from "../../lib/hyperliquid/HyperliquidInfoApi.ts";
import type { Fill } from "../../domain/entities/Fill.ts";
import type {
  IOrderGateway,
  FillListener,
  OrderRequest,
  PlacedOrder,
} from "../../domain/ports/IOrderGateway.ts";

export class HyperliquidOrderGateway implements IOrderGateway {
  private readonly listeners = new Set<FillListener>();
  private seenFillIds = new Set<string>();
  private fillTimer: Timer | null = null;
  private readonly accountAddress: string;

  constructor(
    private readonly info: HyperliquidInfoApi,
    private readonly exchange: HyperliquidExchangeApi,
    private readonly params: {
      market: string;
      accountAddress?: string;
      pollIntervalMs?: number;
    },
  ) {
    this.accountAddress = params.accountAddress ?? exchange.address;
    this.startFillPolling();
  }

  async place(order: OrderRequest): Promise<PlacedOrder> {
    const asset = await this.resolveAsset(order.market);
    const price = order.price ?? (await this.computeAggressivePrice(order));
    const tif = order.timeInForce === "ALO" ? "Alo" : order.timeInForce === "GTC" ? "Gtc" : "Ioc";

    await this.exchange.placeOrders([
      {
        asset,
        isBuy: order.side === "buy",
        price: String(price),
        size: String(order.qty),
        reduceOnly: order.reduceOnly,
        timeInForce: tif,
      },
    ]);

    return {
      id: order.clientOrderId ?? randomUUID(),
      request: { ...order, price },
      status: "open",
    };
  }

  async cancel(id: string): Promise<void> {
    await this.cancelByPredicate((order) => String(order.oid) === id);
  }

  async cancelAll(): Promise<void> {
    await this.cancelByPredicate(() => true);
  }

  subscribeFills(listener: FillListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async resolveAsset(coin: string): Promise<number> {
    const assets = await this.info.getMeta();
    const index = assets.findIndex((a) => a.name === coin);
    if (index < 0) {
      throw new Error(`Unknown Hyperliquid market: ${coin}`);
    }
    return index;
  }

  private async computeAggressivePrice(order: OrderRequest): Promise<number> {
    const book = await this.info.getL2Book(order.market);
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    return order.side === "buy" ? bestAsk * 1.01 : bestBid * 0.99;
  }

  private startFillPolling(): void {
    this.fillTimer = setInterval(() => {
      void this.pollFills().catch(() => undefined);
    }, this.params.pollIntervalMs ?? 1000);
  }

  private async pollFills(): Promise<void> {
    try {
      const fills = await this.info.getUserFills(this.accountAddress);
      for (const fill of fills) {
        if (this.seenFillIds.has(fill.hash)) {
          continue;
        }
        this.seenFillIds.add(fill.hash);
        const normalized: Fill = {
          id: fill.hash,
          venue: "hyperliquid",
          market: fill.coin,
          side: fill.side.toLowerCase().startsWith("b") ? "buy" : "sell",
          price: fill.price,
          qty: fill.size,
          fee: fill.fee,
          tradePnl: fill.closedPnl,
          filledAt: fill.time,
          markPriceAtFill: fill.price,
        };
        for (const listener of this.listeners) {
          void listener(normalized);
        }
      }
    } catch {
      // Next interval will retry.
    }
  }

  private async cancelByPredicate(
    predicate: (order: { coin: string; oid: number }) => boolean,
  ): Promise<void> {
    const openOrders = await this.info.getOpenOrders(this.accountAddress);
    const toCancel = openOrders.filter(predicate);
    if (toCancel.length === 0) {
      return;
    }

    const assets = await this.info.getMeta();
    const cancels = toCancel.map((order) => {
      const asset = assets.findIndex((a) => a.name === order.coin);
      if (asset < 0) {
        throw new Error(`Unknown Hyperliquid market: ${order.coin}`);
      }
      return { asset, oid: order.oid };
    });

    await this.exchange.cancelOrders(cancels);
  }
}
