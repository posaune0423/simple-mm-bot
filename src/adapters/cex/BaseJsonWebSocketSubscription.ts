import type {
  ExternalSubscriptionErrorHandler,
  ExternalTopOfBookHandler,
  ExternalTopOfBookRecordHandler,
  IExternalMarketSubscription,
} from "../../domain/ports/IExternalMarketSubscription.ts";
import { type ExternalNormalizationResult, topOfBookRecordFromUpdate } from "./normalization.ts";
import type { ExternalVenueId } from "../../domain/external-market/ExternalMarketTypes.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

type SubscriptionHandlers = {
  onTopOfBook: ExternalTopOfBookHandler;
  onRecord?: ExternalTopOfBookRecordHandler;
  onError?: ExternalSubscriptionErrorHandler;
};

export abstract class BaseJsonWebSocketSubscription implements IExternalMarketSubscription {
  private socket: WebSocket | undefined;
  private handlers: SubscriptionHandlers | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  protected constructor(
    readonly venue: ExternalVenueId,
    readonly symbol: string,
    private readonly wsUrl: string,
    private readonly reconnectDelayMs: number,
  ) {}

  start(handlers: SubscriptionHandlers): void {
    this.handlers = handlers;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
  }

  protected abstract subscriptionPayload(): string | undefined;
  protected abstract normalizeMessage(payload: unknown): ExternalNormalizationResult;

  private connect(): void {
    if (this.stopped) {
      return;
    }
    try {
      const socket = new WebSocket(this.wsUrl);
      this.socket = socket;
      socket.addEventListener("open", () => {
        const payload = this.subscriptionPayload();
        if (payload !== undefined) {
          socket.send(payload);
        }
        logger.info(
          `[adapter] ExternalMarketSubscription | CONNECTED | venue=${this.venue} symbol=${this.symbol}`,
        );
      });
      socket.addEventListener("message", (event) => this.handleMessage(event.data));
      socket.addEventListener("error", (event) => this.handleError(event));
      socket.addEventListener("close", () => this.scheduleReconnect());
    } catch (error) {
      this.handleError(error);
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: unknown): void {
    try {
      const payload = parseJsonPayload(data);
      const normalized = this.normalizeMessage(payload);
      if (normalized.isErr()) {
        logger.debug(
          `[adapter] ExternalMarketSubscription | NORMALIZATION_SKIPPED | venue=${this.venue} symbol=${this.symbol} reason=${normalized.error.reason}`,
        );
        return;
      }
      const update = normalized.value;
      this.handlers?.onTopOfBook(update);
      this.handlers?.onRecord?.(topOfBookRecordFromUpdate(update));
    } catch (error) {
      this.handleError(error);
    }
  }

  private handleError(error: unknown): void {
    logger.warn(
      `[adapter] ExternalMarketSubscription | ERROR | venue=${this.venue} symbol=${this.symbol} error=${stringifyError(error)}`,
    );
    this.handlers?.onError?.(error);
  }

  private scheduleReconnect(): void {
    this.socket = undefined;
    if (this.stopped || this.reconnectTimer !== undefined) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.reconnectDelayMs);
  }
}

function parseJsonPayload(data: unknown): unknown {
  if (typeof data === "string") {
    return JSON.parse(data);
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(data).toString("utf8"));
  }
  if (data instanceof Uint8Array) {
    return JSON.parse(Buffer.from(data).toString("utf8"));
  }
  return data;
}
