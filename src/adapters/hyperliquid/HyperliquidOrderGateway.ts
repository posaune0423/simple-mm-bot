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
import { stringifyError } from "../../utils/errors.ts";
import { LOG_ORANGE, LOG_RESET, logger } from "../../utils/logger.ts";

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
    logger.info(
      `[adapter] HyperliquidOrderGateway | PLACE_SUBMITTED | market=${order.market} side=${order.side} qty=${order.qty} price=${price} tif=${tif} reduceOnly=${order.reduceOnly}`,
    );

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

    const id = order.clientOrderId ?? randomUUID();
    logger.info(
      `[adapter] HyperliquidOrderGateway | PLACE_RESULT | market=${order.market} orderId=${id} status=open`,
    );
    return {
      id,
      request: { ...order, price },
      status: "open",
    };
  }

  async cancel(id: string): Promise<void> {
    logger.info(
      `[adapter] HyperliquidOrderGateway | CANCEL_SUBMITTED | market=${this.params.market} orderId=${id}`,
    );
    await this.cancelByPredicate((order) => String(order.oid) === id);
  }

  async cancelAll(): Promise<void> {
    logger.info(
      `[adapter] HyperliquidOrderGateway | CANCEL_ALL_SUBMITTED | market=${this.params.market}`,
    );
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
      void this.pollFills().catch((error) => {
        logger.warn(
          `[adapter] HyperliquidOrderGateway | POLL_FILLS_FAILED | error=${stringifyError(error)}`,
        );
      });
    }, this.params.pollIntervalMs ?? 1000);
    logger.info(
      `[adapter] HyperliquidOrderGateway | FILL_POLLING_STARTED | account=${this.accountAddress} intervalMs=${this.params.pollIntervalMs ?? 1000}`,
    );
  }

  private async pollFills(): Promise<void> {
    try {
      const fills = await this.info.getUserFills(this.accountAddress);
      logger.debug(
        `[adapter] HyperliquidOrderGateway | FILLS_POLLED | account=${this.accountAddress} count=${fills.length}`,
      );
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
        logger.info(
          `[adapter] HyperliquidOrderGateway | ${LOG_ORANGE}FILL_RECEIVED${LOG_RESET} | market=${normalized.market} side=${normalized.side} qty=${normalized.qty} price=${normalized.price}`,
        );
        for (const listener of this.listeners) {
          void listener(normalized);
        }
      }
    } catch (error) {
      // Next interval will retry.
      logger.warn(
        `[adapter] HyperliquidOrderGateway | POLL_FILLS_FAILED | error=${stringifyError(error)}`,
      );
    }
  }

  stopBackgroundSync(): void {
    if (this.fillTimer !== null) {
      clearInterval(this.fillTimer);
      this.fillTimer = null;
    }
  }

  private async cancelByPredicate(
    predicate: (order: { coin: string; oid: number }) => boolean,
  ): Promise<void> {
    const openOrders = await this.info.getOpenOrders(this.accountAddress);
    const toCancel = openOrders.filter(predicate);
    if (toCancel.length === 0) {
      logger.debug(
        `[adapter] HyperliquidOrderGateway | CANCEL_NOOP | account=${this.accountAddress}`,
      );
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
    logger.info(`[adapter] HyperliquidOrderGateway | CANCEL_RESULT | count=${cancels.length}`);
  }
}
