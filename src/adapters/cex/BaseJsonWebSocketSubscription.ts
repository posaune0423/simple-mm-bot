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

const SOCKET_STOP_TIMEOUT_MS = 250;

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

  async stop(): Promise<void> {
    this.stopped = true;
    this.handlers = undefined;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.socket;
    this.socket = undefined;
    if (socket !== undefined) {
      await closeSocket(socket);
    }
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
        if (this.stopped || socket !== this.socket) {
          return;
        }
        const payload = this.subscriptionPayload();
        if (payload !== undefined) {
          socket.send(payload);
        }
        logger.info(
          `[adapter] ExternalMarketSubscription | CONNECTED | venue=${this.venue} symbol=${this.symbol}`,
        );
      });
      socket.addEventListener("message", (event) => {
        if (this.stopped || socket !== this.socket) {
          return;
        }
        this.handleMessage(event.data);
      });
      socket.addEventListener("error", (event) => {
        if (socket !== this.socket) {
          return;
        }
        this.handleError(event);
      });
      socket.addEventListener("close", () => this.scheduleReconnect(socket));
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

  private scheduleReconnect(closedSocket?: WebSocket): void {
    if (closedSocket !== undefined && closedSocket !== this.socket) {
      return;
    }
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

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      forceTerminate(socket);
      finish();
    }, SOCKET_STOP_TIMEOUT_MS);

    const finish = (): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      socket.removeEventListener("close", finish);
      socket.removeEventListener("error", finish);
      resolve();
    };

    socket.addEventListener("close", finish, { once: true });
    socket.addEventListener("error", finish, { once: true });

    try {
      if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
    } catch {
      forceTerminate(socket);
      finish();
    }
  });
}

function forceTerminate(socket: WebSocket): void {
  const terminate = (socket as { terminate?: unknown }).terminate;
  if (typeof terminate === "function") {
    terminate.call(socket);
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
