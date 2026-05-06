import { randomUUID } from "node:crypto";

import type { Fill } from "../../domain/entities/Fill.ts";
import type { IMarketFeed, MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import type {
  FillListener,
  IOrderGateway,
  OrderEventListener,
  OrderRequest,
  PlacedOrder,
} from "../../domain/ports/IOrderGateway.ts";
import { logger } from "../../utils/logger.ts";

interface PaperOrderState extends PlacedOrder {
  openedAt: number;
}

export class PaperOrderGateway implements IOrderGateway {
  private readonly listeners = new Set<FillListener>();
  private readonly orderListeners = new Set<OrderEventListener>();
  private readonly openOrders = new Map<string, PaperOrderState>();
  private latestSnapshot: MarketSnapshot | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    marketFeed: IMarketFeed,
    private readonly touchFillRatio: number,
  ) {
    this.unsubscribe = marketFeed.subscribe((snapshot) => {
      this.latestSnapshot = snapshot;
      this.evaluateSnapshot(snapshot);
    });
  }

  async place(order: OrderRequest): Promise<PlacedOrder> {
    const id = order.clientOrderId ?? randomUUID();
    const orderType = order.price === undefined ? "market" : "limit";
    logger.info(
      `paper_order_gateway.place_submitted market=${order.market} orderId=${id} side=${order.side} qty=${order.qty} price=${order.price ?? "market"} tif=${order.timeInForce} reduceOnly=${order.reduceOnly}`,
    );
    await this.publishOrderEvent({
      action: "submit",
      clientOrderId: id,
      intent: order.intent,
      side: order.side,
      orderType,
      price: order.price,
      qty: order.qty,
      reduceOnly: order.reduceOnly,
      timeInForce: order.timeInForce,
    });
    const placed: PaperOrderState = {
      id,
      request: order,
      status: "open",
      openedAt: Date.now(),
    };

    if (order.timeInForce === "IOC") {
      const snapshot = this.latestSnapshot;
      if (snapshot !== null && this.shouldFill(order, snapshot)) {
        await this.fillOrder(placed, snapshot);
      } else {
        placed.status = "cancelled";
        await this.publishOrderEvent({
          action: "cancel",
          clientOrderId: id,
          orderId: id,
          intent: order.intent,
          side: order.side,
          orderType,
          price: order.price,
          qty: order.qty,
          reduceOnly: order.reduceOnly,
          timeInForce: order.timeInForce,
          status: "cancelled",
        });
        logger.info(`paper_order_gateway.ioc_cancelled market=${order.market} orderId=${id}`);
      }
      return placed;
    }

    this.openOrders.set(id, placed);
    await this.publishOrderEvent({
      action: "ack",
      clientOrderId: id,
      orderId: id,
      intent: order.intent,
      side: order.side,
      orderType,
      price: order.price,
      qty: order.qty,
      reduceOnly: order.reduceOnly,
      timeInForce: order.timeInForce,
      status: "open",
    });
    logger.debug(`paper_order_gateway.order_opened market=${order.market} orderId=${id}`);
    if (this.latestSnapshot !== null) {
      this.evaluateSnapshot(this.latestSnapshot);
    }
    return placed;
  }

  async cancel(id: string): Promise<void> {
    this.openOrders.delete(id);
    logger.info(`paper_order_gateway.cancel_submitted orderId=${id}`);
    await this.publishOrderEvent({
      action: "cancel",
      clientOrderId: id,
      orderId: id,
      status: "cancelled",
    });
  }

  async cancelAll(): Promise<void> {
    this.openOrders.clear();
    logger.info("paper_order_gateway.cancel_all_submitted");
  }

  subscribeFills(listener: FillListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeOrderEvents(listener: OrderEventListener): () => void {
    this.orderListeners.add(listener);
    return () => {
      this.orderListeners.delete(listener);
    };
  }

  dispose(): void {
    this.unsubscribe();
    logger.info("paper_order_gateway.disposed");
  }

  private evaluateSnapshot(snapshot: MarketSnapshot): void {
    for (const order of this.openOrders.values()) {
      const shouldFill = this.shouldFill(order.request, snapshot);
      if (shouldFill) {
        logger.debug(
          `paper_order_gateway.order_touched market=${order.request.market} orderId=${order.id} markPrice=${snapshot.markPrice}`,
        );
        void this.fillOrder(order, snapshot);
      }
    }
  }

  private shouldFill(order: OrderRequest, snapshot: MarketSnapshot): boolean {
    const price = order.price ?? (order.side === "buy" ? snapshot.bestAsk : snapshot.bestBid);
    if (order.side === "buy") {
      if (price >= snapshot.bestAsk) {
        return true;
      }
      if (snapshot.low !== undefined && price >= snapshot.low) {
        return true;
      }
      return price >= snapshot.bestBid && this.touchFillRatio > 0;
    }

    if (price <= snapshot.bestBid) {
      return true;
    }
    if (snapshot.high !== undefined && price <= snapshot.high) {
      return true;
    }
    return price <= snapshot.bestAsk && this.touchFillRatio > 0;
  }

  private async fillOrder(order: PaperOrderState, snapshot: MarketSnapshot): Promise<void> {
    this.openOrders.delete(order.id);
    order.status = "filled";
    const fillPrice =
      order.request.price ?? (order.request.side === "buy" ? snapshot.bestAsk : snapshot.bestBid);
    const signedQty = order.request.side === "buy" ? order.request.qty : -order.request.qty;
    const markout5s = snapshot.markPrice + signedQty * this.touchFillRatio;
    const markout30s = snapshot.markPrice + signedQty * this.touchFillRatio * 1.5;
    const fill: Fill = {
      id: order.id,
      venue: "paper",
      market: order.request.market,
      side: order.request.side,
      price: fillPrice,
      qty: order.request.qty,
      fee: fillPrice * order.request.qty * 0.0001,
      tradePnl: 0,
      filledAt: snapshot.timestamp,
      quoteId: order.id,
      markPriceAtFill: snapshot.markPrice,
      markPrice5s: markout5s,
      markPrice30s: markout30s,
    };
    logger.info(
      `paper_order_gateway.fill_created market=${fill.market} orderId=${fill.id} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
    );
    await this.publishOrderEvent({
      action: "fill",
      clientOrderId: order.id,
      orderId: order.id,
      intent: order.request.intent,
      side: order.request.side,
      orderType: order.request.price === undefined ? "market" : "limit",
      price: fillPrice,
      qty: order.request.qty,
      reduceOnly: order.request.reduceOnly,
      timeInForce: order.request.timeInForce,
      status: "filled",
    });
    for (const listener of this.listeners) {
      await listener(fill);
    }
  }

  private async publishOrderEvent(event: Parameters<OrderEventListener>[0]): Promise<void> {
    for (const listener of this.orderListeners) {
      await listener(event);
    }
  }
}
