import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { err } from "neverthrow";

import { BaseJsonWebSocketSubscription } from "../../../../src/adapters/cex/BaseJsonWebSocketSubscription.ts";
import {
  createTopOfBookUpdate,
  ExternalNormalizationError,
  type ExternalNormalizationResult,
} from "../../../../src/adapters/cex/normalization.ts";

describe("BaseJsonWebSocketSubscription", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.reset();
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: originalWebSocket,
    });
  });

  test("sends a subscription payload on open and forwards normalized updates", () => {
    const subscription = new TestJsonSubscription({ subscriptionPayload: '{"op":"subscribe"}' });
    const topOfBookUpdates: unknown[] = [];
    const records: unknown[] = [];

    subscription.start({
      onTopOfBook: (update) => topOfBookUpdates.push(update),
      onRecord: (record) => records.push(record),
    });
    const socket = FakeWebSocket.latest();

    socket.open();
    socket.message(
      JSON.stringify({
        bidPrice: 99,
        bidSize: 2,
        askPrice: 101,
        askSize: 3,
        exchangeTime: 1_700_000_000_001,
        sequence: 42,
      }),
    );

    expect(socket.sent).toEqual(['{"op":"subscribe"}']);
    expect(topOfBookUpdates).toHaveLength(1);
    expect(topOfBookUpdates[0]).toMatchObject({
      venue: "binance_usdm",
      symbol: "BTCUSDT",
      bidPrice: 99,
      askPrice: 101,
      sequence: "42",
    });
    expect(records[0]).toMatchObject({
      id: expect.stringMatching(/^binance_usdm:BTCUSDT:42:1700000000001:\d+$/),
      midPrice: 100,
      spreadBps: 200,
    });
  });

  test("parses binary JSON payloads and ignores normalization failures", () => {
    const subscription = new TestJsonSubscription();
    const topOfBookUpdates: unknown[] = [];

    subscription.start({
      onTopOfBook: (update) => topOfBookUpdates.push(update),
    });
    const socket = FakeWebSocket.latest();

    socket.message(Buffer.from(JSON.stringify({ bidPrice: 98, askPrice: 102 })));
    socket.message(JSON.stringify({ skip: true }));

    expect(topOfBookUpdates).toHaveLength(1);
    expect(topOfBookUpdates[0]).toMatchObject({ bidPrice: 98, askPrice: 102 });
  });

  test("reports malformed JSON through the subscription error handler", () => {
    const subscription = new TestJsonSubscription();
    const errors: unknown[] = [];

    subscription.start({
      onTopOfBook: () => {
        throw new Error("unexpected update");
      },
      onError: (error) => errors.push(error),
    });

    FakeWebSocket.latest().message("{not json");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SyntaxError);
  });

  test("reconnects after close and ignores events from the stale socket", async () => {
    const subscription = new TestJsonSubscription({ reconnectDelayMs: 1 });
    const topOfBookUpdates: unknown[] = [];

    subscription.start({
      onTopOfBook: (update) => topOfBookUpdates.push(update),
    });
    const oldSocket = FakeWebSocket.latest();

    oldSocket.closeFromRemote();
    await waitUntil(() => FakeWebSocket.instances.length === 2, "reconnect");
    const newSocket = FakeWebSocket.latest();

    oldSocket.message(JSON.stringify({ bidPrice: 1, askPrice: 2 }));
    newSocket.message(JSON.stringify({ bidPrice: 99, askPrice: 101 }));

    expect(topOfBookUpdates).toHaveLength(1);
    expect(topOfBookUpdates[0]).toMatchObject({ bidPrice: 99, askPrice: 101 });
  });

  test("stop clears handlers, closes the active socket, and suppresses reconnects", async () => {
    const subscription = new TestJsonSubscription({ reconnectDelayMs: 1 });
    const topOfBookUpdates: unknown[] = [];

    subscription.start({
      onTopOfBook: (update) => topOfBookUpdates.push(update),
    });
    const socket = FakeWebSocket.latest();

    await subscription.stop();
    socket.message(JSON.stringify({ bidPrice: 99, askPrice: 101 }));
    socket.closeFromRemote();
    await Bun.sleep(5);

    expect(socket.closeCount).toBe(1);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(topOfBookUpdates).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

class TestJsonSubscription extends BaseJsonWebSocketSubscription {
  private readonly payload: string | undefined;

  constructor(
    options: {
      subscriptionPayload?: string;
      reconnectDelayMs?: number;
    } = {},
  ) {
    super("binance_usdm", "BTCUSDT", "wss://example.test/ws", options.reconnectDelayMs ?? 10);
    this.payload = options.subscriptionPayload;
  }

  protected subscriptionPayload(): string | undefined {
    return this.payload;
  }

  protected normalizeMessage(payload: unknown): ExternalNormalizationResult {
    if (isObject(payload) && payload.skip === true) {
      return err(new ExternalNormalizationError("missing_book", { payload }));
    }
    return createTopOfBookUpdate({
      venue: this.venue,
      symbol: this.symbol,
      bidPrice: isObject(payload) ? payload.bidPrice : undefined,
      bidSize: isObject(payload) ? (payload.bidSize ?? 1) : undefined,
      askPrice: isObject(payload) ? payload.askPrice : undefined,
      askSize: isObject(payload) ? (payload.askSize ?? 1) : undefined,
      exchangeTime: isObject(payload) ? payload.exchangeTime : undefined,
      sequence: isObject(payload) ? payload.sequence : undefined,
      raw: payload,
    });
  }
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: WebSocketEvent) => void>>();
  closeCount = 0;
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) {
      throw new Error("No fake websocket was created");
    }
    return socket;
  }

  addEventListener(
    type: string,
    listener: (event: WebSocketEvent) => void,
    options?: { once?: boolean },
  ): void {
    const wrapped = options?.once === true ? this.once(type, listener) : listener;
    const listeners = this.listeners.get(type) ?? new Set<(event: WebSocketEvent) => void>();
    listeners.add(wrapped);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: WebSocketEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = FakeWebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch("close", {});
    });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  message(data: unknown): void {
    this.dispatch("message", { data });
  }

  closeFromRemote(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", {});
  }

  private dispatch(type: string, event: WebSocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  private once(type: string, listener: (event: WebSocketEvent) => void) {
    const wrapped = (event: WebSocketEvent): void => {
      this.listeners.get(type)?.delete(wrapped);
      listener(event);
    };
    return wrapped;
  }
}

type WebSocketEvent = {
  data?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
