import { randomUUID } from "node:crypto";

import type { Fill } from "../../domain/entities/Fill.ts";
import type {
  FillListener,
  IOrderGateway,
  OrderRequest,
  PlacedOrder,
} from "../../domain/ports/IOrderGateway.ts";
import { logger } from "../../utils/logger.ts";

type BulkStatus = Record<string, Record<string, unknown> | undefined>;
type BulkOrderResponse = {
  status?: string;
  response?: { data?: { statuses?: BulkStatus[] } };
};
type BulkFill = {
  maker?: string;
  taker?: string;
  orderIdMaker?: string;
  orderIdTaker?: string;
  isBuy?: boolean;
  symbol?: string;
  amount?: number;
  price?: number;
  fee?: number;
  timestamp?: number;
};

interface BulkTradeClient {
  placeLimitOrder?(params: unknown): Promise<BulkOrderResponse>;
  placeMarketOrder?(params: unknown): Promise<BulkOrderResponse>;
  cancelOrder?(params: unknown): Promise<BulkOrderResponse>;
  cancelAll?(params: unknown): Promise<BulkOrderResponse>;
}

interface BulkAccountClient {
  fills(user: string): Promise<BulkFill[]>;
}

export interface BulkOrderGatewayClient {
  trade: BulkTradeClient;
  account: BulkAccountClient;
}

export interface BulkOrderGatewayParams {
  market: string;
  accountId: string;
  pollIntervalMs?: number;
}

const openStatusKeys = new Set(["resting", "working"]);
const filledStatusKeys = new Set(["filled", "partiallyFilled"]);
const cancelledStatusKeys = new Set([
  "cancelled",
  "cancelledRiskLimit",
  "cancelledSelfCrossing",
  "cancelledReduceOnly",
  "cancelledIoc",
]);

function nsToMs(timestamp: number | undefined): number {
  if (timestamp === undefined) {
    return Date.now();
  }
  return timestamp > 9_999_999_999_999 ? Math.floor(timestamp / 1_000_000) : timestamp;
}

function statusEntries(response: BulkOrderResponse): BulkStatus[] {
  return response.response?.data?.statuses ?? [];
}

function statusKey(status: BulkStatus): string | undefined {
  return Object.keys(status)[0];
}

function statusPayload(status: BulkStatus): Record<string, unknown> {
  const key = statusKey(status);
  if (!key) {
    return {};
  }
  return status[key] ?? {};
}

function orderIdFrom(status: BulkStatus): string | undefined {
  const payload = statusPayload(status);
  const oid = payload.oid;
  return typeof oid === "string" || typeof oid === "number" ? String(oid) : undefined;
}

function placedStatusFrom(status: BulkStatus): PlacedOrder["status"] {
  const key = statusKey(status);
  if (!key) {
    return "rejected";
  }
  if (openStatusKeys.has(key)) {
    return "open";
  }
  if (filledStatusKeys.has(key)) {
    return "filled";
  }
  if (cancelledStatusKeys.has(key)) {
    return "cancelled";
  }
  return "rejected";
}

export class BulkOrderGateway implements IOrderGateway {
  private readonly listeners = new Set<FillListener>();
  private readonly seenFillIds = new Set<string>();
  private fillTimer: Timer | null = null;

  constructor(
    private readonly client: BulkOrderGatewayClient,
    private readonly params: BulkOrderGatewayParams,
  ) {
    if (params.pollIntervalMs !== undefined) {
      this.fillTimer = setInterval(() => {
        void this.pollFillsOnce().catch((error) => {
          logger.error(`BulkOrderGateway.pollFillsOnce failed: ${String(error)}`);
        });
      }, params.pollIntervalMs);
    }
  }

  async place(order: OrderRequest): Promise<PlacedOrder> {
    const response =
      order.price === undefined || order.timeInForce === "IOC"
        ? await this.client.trade.placeMarketOrder?.({
            symbol: order.market,
            side: order.side,
            size: order.qty,
            reduceOnly: order.reduceOnly,
          })
        : await this.client.trade.placeLimitOrder?.({
            symbol: order.market,
            side: order.side,
            price: order.price,
            size: order.qty,
            tif: order.timeInForce,
            reduceOnly: order.reduceOnly,
          });

    const firstStatus = statusEntries(response ?? {})[0] ?? {};
    return {
      id: orderIdFrom(firstStatus) ?? order.clientOrderId ?? randomUUID(),
      request: order,
      status: placedStatusFrom(firstStatus),
    };
  }

  async cancel(id: string): Promise<void> {
    await this.client.trade.cancelOrder?.({ symbol: this.params.market, orderId: id });
  }

  async cancelAll(): Promise<void> {
    await this.client.trade.cancelAll?.({ symbols: [this.params.market] });
  }

  subscribeFills(listener: FillListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.fillTimer !== null) {
      clearInterval(this.fillTimer);
      this.fillTimer = null;
    }
  }

  async pollFillsOnce(): Promise<void> {
    const fills = await this.client.account.fills(this.params.accountId);
    for (const fill of fills) {
      const normalized = this.normalizeFill(fill);
      if (normalized === null || this.seenFillIds.has(normalized.id)) {
        continue;
      }
      this.seenFillIds.add(normalized.id);
      for (const listener of this.listeners) {
        await listener(normalized);
      }
    }
  }

  private normalizeFill(fill: BulkFill): Fill | null {
    const side = this.sideOf(fill);
    const orderId = fill.maker === this.params.accountId ? fill.orderIdMaker : fill.orderIdTaker;
    if (
      side === null ||
      orderId === undefined ||
      fill.symbol === undefined ||
      fill.amount === undefined ||
      fill.price === undefined
    ) {
      return null;
    }
    const timestamp = fill.timestamp ?? Date.now();
    return {
      id: `${orderId}:${timestamp}`,
      venue: "bulk",
      market: fill.symbol,
      side,
      price: fill.price,
      qty: fill.amount,
      fee: fill.fee ?? 0,
      tradePnl: 0,
      filledAt: nsToMs(timestamp),
      quoteId: orderId,
      markPriceAtFill: fill.price,
    };
  }

  private sideOf(fill: BulkFill): "buy" | "sell" | null {
    if (fill.isBuy === undefined) {
      return null;
    }
    if (fill.taker === this.params.accountId) {
      return fill.isBuy ? "buy" : "sell";
    }
    if (fill.maker === this.params.accountId) {
      return fill.isBuy ? "sell" : "buy";
    }
    return null;
  }
}
