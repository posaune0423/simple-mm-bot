import { BulkClient } from "bulk-ts-sdk";
import type {
  BookUpdate,
  L2SnapshotWsMessage,
  MarketStats,
  TickerWsMessage,
  TradesWsMessage,
  WsSubscription,
} from "bulk-ts-sdk";

import type {
  IMarketDataRecorderClient,
  MarketDataRecorderHandlers,
} from "../../domain/ports/IMarketDataRecorderClient.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";
import {
  normalizeBulkBookSnapshot,
  normalizeBulkTicker,
  normalizeBulkTrades,
} from "./marketDataNormalization.ts";

type BulkSubscriptionHandle = { unsubscribe(): Promise<void> };

interface BulkRecorderWsClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  subscribe<T>(
    subscription: WsSubscription,
    handler: (message: T) => void | Promise<void>,
  ): Promise<BulkSubscriptionHandle>;
}

interface BulkRecorderMarketClient {
  ticker(symbol: string): Promise<MarketStats>;
  l2Book(params: { symbol: string; nlevels?: number }): Promise<BookUpdate>;
}

interface BulkRecorderClient {
  market: BulkRecorderMarketClient;
  ws: BulkRecorderWsClient;
}

export type BulkMarketDataRecorderClientParams = {
  httpUrl?: string;
  wsUrl?: string;
  symbol: string;
  depth: number;
  reconnectIntervalMs?: number;
  client?: BulkRecorderClient;
};

const DEFAULT_RECONNECT_INTERVAL_MS = 1_000;

export class BulkMarketDataRecorderClient implements IMarketDataRecorderClient {
  private readonly client: BulkRecorderClient;
  private readonly reconnectIntervalMs: number;
  private readonly unsubscribers: Array<() => Promise<void>> = [];
  private handlers: MarketDataRecorderHandlers = {};
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInFlight = false;

  constructor(private readonly params: BulkMarketDataRecorderClientParams) {
    this.client =
      params.client ??
      new BulkClient({
        httpUrl: params.httpUrl,
        wsUrl: params.wsUrl,
      });
    this.reconnectIntervalMs = params.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS;
  }

  async connect(handlers: MarketDataRecorderHandlers): Promise<void> {
    this.handlers = handlers;
    this.connected = true;
    await this.connectOnce();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.unsubscribeAll();
    await this.client.ws.close();
  }

  private async connectOnce(): Promise<void> {
    try {
      await this.client.ws.connect();
      await this.seedHttpSnapshot();
      await this.subscribeWs();
      logger.info(
        `[adapter] BulkMarketDataRecorderClient | CONNECTED | symbol=${this.params.symbol} depth=${this.params.depth}`,
      );
    } catch (error) {
      this.handlers.onError?.(error);
      await this.scheduleReconnect(error);
    }
  }

  private async seedHttpSnapshot(): Promise<void> {
    const receivedAt = Date.now();
    const [book, ticker] = await Promise.all([
      this.client.market.l2Book({ symbol: this.params.symbol, nlevels: this.params.depth }),
      this.client.market.ticker(this.params.symbol),
    ]);
    const snapshot = normalizeBulkBookSnapshot({
      venue: "bulk",
      symbol: this.params.symbol,
      depth: this.params.depth,
      receivedAt,
      book,
    });
    if (snapshot !== null) {
      this.handlers.onBookSnapshot?.(snapshot);
    }
    this.handlers.onTicker?.(
      normalizeBulkTicker({
        venue: "bulk",
        symbol: this.params.symbol,
        receivedAt,
        ticker,
      }),
    );
  }

  private async subscribeWs(): Promise<void> {
    const ticker = await this.client.ws.subscribe<TickerWsMessage>(
      { type: "ticker", symbol: this.params.symbol },
      (message) => this.handleTicker(message),
    );
    const book = await this.client.ws.subscribe<L2SnapshotWsMessage>(
      { type: "l2Snapshot", symbol: this.params.symbol, nlevels: this.params.depth },
      (message) => this.handleBook(message),
    );
    const trades = await this.client.ws.subscribe<TradesWsMessage>(
      { type: "trades", symbol: this.params.symbol },
      (message) => this.handleTrades(message),
    );
    this.unsubscribers.push(
      async () => ticker.unsubscribe(),
      async () => book.unsubscribe(),
      async () => trades.unsubscribe(),
    );
  }

  private handleBook(message: L2SnapshotWsMessage): void {
    const snapshot = normalizeBulkBookSnapshot({
      venue: "bulk",
      symbol: this.params.symbol,
      depth: this.params.depth,
      receivedAt: Date.now(),
      book: message.data.book,
    });
    if (snapshot !== null) {
      this.handlers.onBookSnapshot?.(snapshot);
    }
  }

  private handleTicker(message: TickerWsMessage): void {
    this.handlers.onTicker?.(
      normalizeBulkTicker({
        venue: "bulk",
        symbol: this.params.symbol,
        receivedAt: Date.now(),
        ticker: message.data.ticker,
      }),
    );
  }

  private handleTrades(message: TradesWsMessage): void {
    for (const trade of normalizeBulkTrades({
      venue: "bulk",
      symbol: this.params.symbol,
      receivedAt: Date.now(),
      trades: message.data.trades,
    })) {
      this.handlers.onTrade?.(trade);
    }
  }

  private async scheduleReconnect(cause: unknown): Promise<void> {
    if (!this.connected || this.reconnectInFlight) {
      return;
    }
    this.reconnectInFlight = true;
    logger.warn(
      `[adapter] BulkMarketDataRecorderClient | RECONNECT_SCHEDULED | symbol=${this.params.symbol} intervalMs=${this.reconnectIntervalMs} error=${stringifyError(cause)}`,
    );
    try {
      await this.unsubscribeAll();
    } catch (error) {
      this.handlers.onError?.(error);
      logger.warn(
        `[adapter] BulkMarketDataRecorderClient | RECONNECT_UNSUBSCRIBE_FAILED | symbol=${this.params.symbol} error=${stringifyError(error)}`,
      );
    }
    try {
      await this.client.ws.close();
    } catch (error) {
      this.handlers.onError?.(error);
      logger.warn(
        `[adapter] BulkMarketDataRecorderClient | RECONNECT_CLOSE_FAILED | symbol=${this.params.symbol} error=${stringifyError(error)}`,
      );
    }
    if (!this.shouldReconnect()) {
      this.reconnectInFlight = false;
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectInFlight = false;
      if (this.connected) {
        void this.connectOnce();
      }
    }, this.reconnectIntervalMs);
  }

  private async unsubscribeAll(): Promise<void> {
    const unsubscribers = this.unsubscribers.splice(0);
    const results = await Promise.allSettled(
      unsubscribers.map(async (unsubscribe) => unsubscribe()),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        this.handlers.onError?.(result.reason);
      }
    }
  }

  private shouldReconnect(): boolean {
    return this.connected;
  }
}
