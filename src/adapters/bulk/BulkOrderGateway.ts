import { randomUUID } from "node:crypto";

import type { Fill } from "../../domain/entities/Fill.ts";
import type { Position } from "../../domain/entities/Position.ts";
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
type BulkLeverageEntry = {
  symbol?: string;
  leverage?: number;
};
type BulkPositionEntry = {
  symbol?: string;
  size?: number;
  price?: number;
  unrealizedPnl?: number;
  iso?: boolean;
};
type BulkFullAccount = {
  leverageSettings?: BulkLeverageEntry[];
  positions?: BulkPositionEntry[];
};

interface BulkTradeClient {
  placeLimitOrder?(params: unknown): Promise<BulkOrderResponse>;
  placeMarketOrder?(params: unknown): Promise<BulkOrderResponse>;
  cancelOrder?(params: unknown): Promise<BulkOrderResponse>;
  cancelAll?(params: unknown): Promise<BulkOrderResponse>;
}

interface BulkAccountClient {
  fullAccount?(user: string): Promise<BulkFullAccount>;
  fills(user: string): Promise<BulkFill[]>;
}

export interface BulkOrderGatewayClient {
  trade: BulkTradeClient;
  account: BulkAccountClient;
}

export interface BulkOrderGatewayParams {
  market: string;
  accountId: string;
  maxLeverage?: number;
  pollIntervalMs?: number;
}

const openStatusKeys = new Set(["resting", "working"]);
const filledStatusKeys = new Set(["filled"]);
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

function rejectReasonFrom(status: BulkStatus): string | undefined {
  const payload = statusPayload(status);
  const reason = payload.reason;
  return typeof reason === "string" ? reason : undefined;
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
  if (key === "partiallyFilled") {
    return "partially_filled";
  }
  if (cancelledStatusKeys.has(key)) {
    return "cancelled";
  }
  return "rejected";
}

function isCrossPosition(entry: BulkPositionEntry, market: string): boolean {
  return entry.symbol === market && (entry.iso ?? false) === false;
}

export class BulkOrderGateway implements IOrderGateway {
  private readonly listeners = new Set<FillListener>();
  private readonly seenFillIds = new Set<string>();
  private leverageChecked = false;
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
    await this.ensureMaxLeverage(order);
    const type = order.price === undefined ? "market" : "limit";
    logger.info(
      `bulk_order_gateway.place_submitted market=${order.market} type=${type} side=${order.side} qty=${order.qty} price=${order.price ?? "market"} tif=${order.timeInForce} reduceOnly=${order.reduceOnly}`,
    );
    const response =
      order.price === undefined
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
    const orderId = orderIdFrom(firstStatus) ?? order.clientOrderId ?? randomUUID();
    const status = placedStatusFrom(firstStatus);
    const key = statusKey(firstStatus) ?? "missing";
    const reason = rejectReasonFrom(firstStatus);
    const resultMessage = `bulk_order_gateway.place_result market=${order.market} orderId=${orderId} status=${status} statusKey=${key}`;
    if (status === "rejected") {
      logger.warn(reason === undefined ? resultMessage : `${resultMessage} reason=${reason}`);
    } else {
      logger.info(resultMessage);
    }
    return {
      id: orderId,
      request: order,
      status,
    };
  }

  private async ensureMaxLeverage(order: OrderRequest): Promise<void> {
    if (order.reduceOnly || this.leverageChecked || this.params.maxLeverage === undefined) {
      return;
    }
    if (!this.client.account.fullAccount) {
      throw new Error(
        `Bulk account leverage settings are required to verify ${this.params.market} max leverage before live orders.`,
      );
    }

    const account = await this.client.account.fullAccount(this.params.accountId);
    const leverage = account.leverageSettings?.find(
      (entry) => entry.symbol === this.params.market,
    )?.leverage;
    if (leverage === undefined) {
      throw new Error(
        `Bulk leverage for ${this.params.market} is unavailable; expected <= ${this.params.maxLeverage}x. Set leverage in Bulk UI or a supported API path before starting live orders.`,
      );
    }
    if (leverage > this.params.maxLeverage) {
      throw new Error(
        `Bulk leverage for ${this.params.market} is ${leverage}x; expected <= ${this.params.maxLeverage}x. Set leverage in Bulk UI or a supported API path before starting live orders.`,
      );
    }

    logger.info(
      `bulk_order_gateway.leverage_verified market=${this.params.market} leverage=${leverage} maxLeverage=${this.params.maxLeverage}`,
    );
    this.leverageChecked = true;
  }

  async cancel(id: string): Promise<void> {
    logger.info(`bulk_order_gateway.cancel_submitted market=${this.params.market} orderId=${id}`);
    await this.client.trade.cancelOrder?.({ symbol: this.params.market, orderId: id });
  }

  async cancelAll(): Promise<void> {
    logger.info(`bulk_order_gateway.cancel_all_submitted market=${this.params.market}`);
    await this.client.trade.cancelAll?.({ symbols: [this.params.market] });
  }

  subscribeFills(listener: FillListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async syncFills(): Promise<void> {
    await this.pollFillsOnce();
  }

  async getPosition(): Promise<Position> {
    if (!this.client.account.fullAccount) {
      throw new Error(`Bulk fullAccount is required to read ${this.params.market} position.`);
    }
    const account = await this.client.account.fullAccount(this.params.accountId);
    const position = account.positions?.find((entry) => isCrossPosition(entry, this.params.market));

    return {
      qty: position?.size ?? 0,
      avgEntry: position?.price ?? 0,
      unrealizedPnl: position?.unrealizedPnl ?? 0,
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
    logger.debug(
      `bulk_order_gateway.fills_polled market=${this.params.market} accountId=${this.params.accountId} count=${fills.length}`,
    );
    for (const fill of fills) {
      const normalized = this.normalizeFill(fill);
      if (normalized === null || this.seenFillIds.has(normalized.id)) {
        continue;
      }
      this.seenFillIds.add(normalized.id);
      logger.info(
        `bulk_order_gateway.fill_received market=${normalized.market} orderId=${normalized.quoteId} side=${normalized.side} qty=${normalized.qty} price=${normalized.price}`,
      );
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
