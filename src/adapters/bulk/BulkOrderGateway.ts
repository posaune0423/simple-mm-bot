import { randomUUID } from "node:crypto";

import type { Fill } from "../../domain/entities/Fill.ts";
import type { Position } from "../../domain/entities/Position.ts";
import type {
  FillListener,
  IOrderGateway,
  OrderEventListener,
  OrderRequest,
  PlacedOrder,
} from "../../domain/ports/IOrderGateway.ts";
import { logger } from "../../utils/logger.ts";

type BulkStatus = Record<string, Record<string, unknown> | undefined>;
type BulkOrderResponse = {
  status?: string;
  response?: { data?: { statuses?: BulkStatus[] } };
};
type BulkMarketInfo = {
  symbol?: string;
  pricePrecision?: number;
  sizePrecision?: number;
  tickSize?: number;
  lotSize?: number;
  minNotional?: number;
  timeInForces?: string[];
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
type BulkHttpErrorLike = {
  status?: unknown;
  data?: unknown;
  message?: unknown;
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

interface BulkOrderGatewayClient {
  market?: { exchangeInfo?(): Promise<BulkMarketInfo[]> };
  trade: BulkTradeClient;
  account: BulkAccountClient;
}

interface BulkOrderGatewayParams {
  market: string;
  accountId: string;
  maxLeverage?: number;
  pollIntervalMs?: number;
}

type BulkMarketRules = {
  pricePrecision?: number;
  sizePrecision?: number;
  tickSize?: number;
  lotSize?: number;
  minNotional?: number;
  timeInForces: Set<string>;
};

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

function isBulkHttpOrderRejection(error: unknown): error is BulkHttpErrorLike {
  return typeof error === "object" && error !== null && (error as BulkHttpErrorLike).status === 422;
}

function orderRejectionReason(error: BulkHttpErrorLike): string {
  if (error.data !== undefined) {
    return JSON.stringify(error.data);
  }
  return typeof error.message === "string" && error.message.length > 0
    ? error.message
    : "HTTP error 422";
}

function summarizeOrderError(error: BulkHttpErrorLike): unknown {
  return {
    status: error.status,
    data: error.data,
    message: error.message,
  };
}

function isRejectedOrderResult(
  response: BulkOrderResponse | undefined | { rejectedOrder: PlacedOrder },
): response is { rejectedOrder: PlacedOrder } {
  return typeof response === "object" && "rejectedOrder" in response;
}

export class BulkOrderGateway implements IOrderGateway {
  private readonly listeners = new Set<FillListener>();
  private readonly orderListeners = new Set<OrderEventListener>();
  private readonly seenFillIds = new Set<string>();
  private rulesPromise: Promise<BulkMarketRules | null> | null = null;
  private pollInFlight: Promise<void> | null = null;
  private leverageChecked = false;
  private fillTimer: Timer | null = null;

  constructor(
    private readonly client: BulkOrderGatewayClient,
    private readonly params: BulkOrderGatewayParams,
  ) {
    if (params.pollIntervalMs !== undefined) {
      this.fillTimer = setInterval(() => {
        void this.pollFillsFromTimer();
      }, params.pollIntervalMs);
    }
  }

  async place(order: OrderRequest): Promise<PlacedOrder> {
    const normalizedOrder = await this.normalizeOrder(order);
    await this.ensureMaxLeverage(normalizedOrder);
    const type = normalizedOrder.price === undefined ? "market" : "limit";
    const submittedAt = Date.now();
    logger.info(
      `bulk_order_gateway.place_submitted market=${normalizedOrder.market} type=${type} side=${normalizedOrder.side} qty=${normalizedOrder.qty} price=${normalizedOrder.price ?? "market"} tif=${normalizedOrder.timeInForce} reduceOnly=${normalizedOrder.reduceOnly}`,
    );
    await this.publishOrderEvent({
      action: "submit",
      clientOrderId: normalizedOrder.clientOrderId,
      intent: normalizedOrder.intent,
      side: normalizedOrder.side,
      orderType: type,
      price: normalizedOrder.price,
      qty: normalizedOrder.qty,
      reduceOnly: normalizedOrder.reduceOnly,
      timeInForce: normalizedOrder.timeInForce,
    });
    const response = await this.submitOrder(normalizedOrder, type).catch(async (error) => {
      if (!isBulkHttpOrderRejection(error)) {
        throw error;
      }
      const orderId = normalizedOrder.clientOrderId ?? randomUUID();
      const reason = orderRejectionReason(error);
      logger.warn(
        `bulk_order_gateway.place_result market=${normalizedOrder.market} orderId=${orderId} status=rejected statusKey=http_422 reason=${reason}`,
      );
      await this.publishOrderEvent({
        action: "reject",
        clientOrderId: normalizedOrder.clientOrderId,
        orderId,
        intent: normalizedOrder.intent,
        side: normalizedOrder.side,
        orderType: type,
        price: normalizedOrder.price,
        qty: normalizedOrder.qty,
        reduceOnly: normalizedOrder.reduceOnly,
        timeInForce: normalizedOrder.timeInForce,
        latencyMs: Date.now() - submittedAt,
        status: "rejected",
        statusKey: "http_422",
        reason,
        rawSummary: summarizeOrderError(error),
      });
      return {
        rejectedOrder: {
          id: orderId,
          request: normalizedOrder,
          status: "rejected" as const,
        },
      };
    });
    if (isRejectedOrderResult(response)) {
      return response.rejectedOrder;
    }

    const firstStatus = statusEntries(response ?? {})[0] ?? {};
    const orderId = orderIdFrom(firstStatus) ?? normalizedOrder.clientOrderId ?? randomUUID();
    const status = placedStatusFrom(firstStatus);
    const key = statusKey(firstStatus) ?? "missing";
    const reason = rejectReasonFrom(firstStatus);
    const resultMessage = `bulk_order_gateway.place_result market=${normalizedOrder.market} orderId=${orderId} status=${status} statusKey=${key}`;
    if (status === "rejected") {
      logger.warn(reason === undefined ? resultMessage : `${resultMessage} reason=${reason}`);
    } else {
      logger.info(resultMessage);
    }
    await this.publishOrderEvent({
      action: status === "rejected" ? "reject" : "ack",
      clientOrderId: normalizedOrder.clientOrderId,
      orderId,
      intent: normalizedOrder.intent,
      side: normalizedOrder.side,
      orderType: type,
      price: normalizedOrder.price,
      qty: normalizedOrder.qty,
      reduceOnly: normalizedOrder.reduceOnly,
      timeInForce: normalizedOrder.timeInForce,
      latencyMs: Date.now() - submittedAt,
      status,
      statusKey: key,
      reason,
      rawSummary: summarizeResponse(response),
    });
    return {
      id: orderId,
      request: normalizedOrder,
      status,
    };
  }

  private async normalizeOrder(order: OrderRequest): Promise<OrderRequest> {
    const rules = await this.marketRules();
    if (rules === null) {
      return order;
    }

    if (rules.timeInForces.size > 0 && !rules.timeInForces.has(order.timeInForce)) {
      throw new Error(
        `Bulk ${order.market} does not support timeInForce=${order.timeInForce}; supported=${[...rules.timeInForces].join(",")}`,
      );
    }

    const qty = normalizeSize(order.qty, rules);
    if (qty <= 0) {
      throw new Error(`Bulk ${order.market} order size rounds to zero: qty=${order.qty}`);
    }

    const price =
      order.price === undefined ? undefined : normalizePrice(order.side, order.price, rules);
    if (price !== undefined && rules.minNotional !== undefined && price * qty < rules.minNotional) {
      throw new Error(
        `Bulk ${order.market} order notional is below minimum: notional=${price * qty} minNotional=${rules.minNotional}`,
      );
    }

    return { ...order, price, qty };
  }

  private async marketRules(): Promise<BulkMarketRules | null> {
    if (this.rulesPromise === null) {
      this.rulesPromise = this.loadMarketRules();
    }
    return await this.rulesPromise;
  }

  private async loadMarketRules(): Promise<BulkMarketRules | null> {
    if (!this.client.market?.exchangeInfo) {
      return null;
    }
    const markets = await this.client.market.exchangeInfo();
    const market = markets.find((entry) => entry.symbol === this.params.market);
    if (market === undefined) {
      throw new Error(`Bulk exchangeInfo does not include market=${this.params.market}`);
    }
    return {
      pricePrecision: market.pricePrecision,
      sizePrecision: market.sizePrecision,
      tickSize: market.tickSize,
      lotSize: market.lotSize,
      minNotional: market.minNotional,
      timeInForces: new Set(market.timeInForces ?? []),
    };
  }

  private async submitOrder(
    order: OrderRequest,
    type: "limit" | "market",
  ): Promise<BulkOrderResponse | undefined> {
    return type === "market"
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
    const submittedAt = Date.now();
    await this.client.trade.cancelOrder?.({ symbol: this.params.market, orderId: id });
    await this.publishOrderEvent({
      action: "cancel",
      orderId: id,
      intent: "quote",
      latencyMs: Date.now() - submittedAt,
      rawSummary: { request: "cancelOrder" },
    });
  }

  async cancelAll(): Promise<void> {
    logger.info(`bulk_order_gateway.cancel_all_submitted market=${this.params.market}`);
    const submittedAt = Date.now();
    await this.client.trade.cancelAll?.({ symbols: [this.params.market] });
    await this.publishOrderEvent({
      action: "cancel",
      latencyMs: Date.now() - submittedAt,
      rawSummary: { request: "cancelAll", symbols: [this.params.market] },
    });
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

  async syncFills(): Promise<void> {
    await this.pollFillsSerialized();
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

  async dispose(): Promise<void> {
    if (this.fillTimer !== null) {
      clearInterval(this.fillTimer);
      this.fillTimer = null;
    }
    await this.pollInFlight?.catch((error) => {
      logger.warn(
        `bulk_order_gateway.dispose_poll_failed market=${this.params.market} error=${String(error)}`,
      );
    });
  }

  private async pollFillsFromTimer(): Promise<void> {
    if (this.pollInFlight !== null) {
      return;
    }
    await this.pollFillsSerialized().catch((error) => {
      logger.error(`BulkOrderGateway.pollFillsOnce failed: ${String(error)}`);
    });
  }

  private async pollFillsSerialized(): Promise<void> {
    if (this.pollInFlight !== null) {
      await this.pollInFlight;
      return;
    }
    const task = this.pollFillsOnce();
    this.pollInFlight = task;
    try {
      await task;
    } finally {
      if (this.pollInFlight === task) {
        this.pollInFlight = null;
      }
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
      await this.publishOrderEvent({
        action: "fill",
        orderId: normalized.quoteId,
        intent: "quote",
        side: normalized.side,
        orderType: "limit",
        price: normalized.price,
        qty: normalized.qty,
        status: "filled",
        rawSummary: summarizeFill(fill),
      });
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

  private async publishOrderEvent(event: Parameters<OrderEventListener>[0]): Promise<void> {
    for (const listener of this.orderListeners) {
      await listener(event);
    }
  }
}

function summarizeResponse(response: BulkOrderResponse | undefined): unknown {
  return {
    status: response?.status,
    statuses: statusEntries(response ?? {}).map((status) => ({
      key: statusKey(status) ?? "missing",
      oid: orderIdFrom(status),
      reason: rejectReasonFrom(status),
    })),
  };
}

function summarizeFill(fill: BulkFill): unknown {
  return {
    makerPresent: fill.maker !== undefined,
    takerPresent: fill.taker !== undefined,
    orderIdMakerPresent: fill.orderIdMaker !== undefined,
    orderIdTakerPresent: fill.orderIdTaker !== undefined,
    isBuyPresent: fill.isBuy !== undefined,
    timestampPresent: fill.timestamp !== undefined,
  };
}

function normalizePrice(side: "buy" | "sell", price: number, rules: BulkMarketRules): number {
  if (rules.tickSize !== undefined && rules.tickSize > 0) {
    return side === "buy"
      ? floorToStep(price, rules.tickSize, rules.pricePrecision)
      : ceilToStep(price, rules.tickSize, rules.pricePrecision);
  }
  if (rules.pricePrecision !== undefined) {
    return roundToPrecision(price, rules.pricePrecision);
  }
  return price;
}

function normalizeSize(size: number, rules: BulkMarketRules): number {
  if (rules.lotSize !== undefined && rules.lotSize > 0) {
    return floorToStep(size, rules.lotSize, rules.sizePrecision);
  }
  if (rules.sizePrecision !== undefined) {
    return floorToPrecision(size, rules.sizePrecision);
  }
  return size;
}

function floorToStep(value: number, step: number, precision?: number): number {
  const decimals = precision ?? decimalPlaces(step);
  return roundToPrecision(Math.floor(value / step + 1e-9) * step, decimals);
}

function ceilToStep(value: number, step: number, precision?: number): number {
  const decimals = precision ?? decimalPlaces(step);
  return roundToPrecision(Math.ceil(value / step - 1e-9) * step, decimals);
}

function floorToPrecision(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.floor(value * factor + 1e-9) / factor;
}

function roundToPrecision(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function decimalPlaces(value: number): number {
  const text = value.toString();
  const exponent = text.match(/e-(\d+)$/i)?.[1];
  if (exponent !== undefined) {
    return Number(exponent);
  }
  const decimals = text.split(".")[1];
  return decimals?.length ?? 0;
}
