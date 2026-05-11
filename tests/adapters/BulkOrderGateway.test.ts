import { describe, expect, test } from "bun:test";

import { BulkOrderGateway } from "../../src/adapters/bulk/BulkOrderGateway.ts";
import { logger } from "../../src/utils/logger.ts";

function captureLogs() {
  const info = logger.info;
  const debug = logger.debug;
  const messages: string[] = [];
  logger.info = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  logger.debug = (...args: unknown[]) => {
    messages.push(args.join(" "));
  };
  return {
    messages,
    restore() {
      logger.info = info;
      logger.debug = debug;
    },
  };
}

function captureWarnAndErrorLogs() {
  const warn = logger.warn;
  const error = logger.error;
  const warnMessages: string[] = [];
  const errorMessages: string[] = [];
  logger.warn = (...args: unknown[]) => {
    warnMessages.push(args.join(" "));
  };
  logger.error = (...args: unknown[]) => {
    errorMessages.push(args.join(" "));
  };
  return {
    warnMessages,
    errorMessages,
    restore() {
      logger.warn = warn;
      logger.error = error;
    },
  };
}

describe("BulkOrderGateway", () => {
  test("maps limit, market, cancel, and cancelAll calls to the SDK", async () => {
    const calls: unknown[] = [];
    const client = {
      trade: {
        async placeLimitOrder(params: unknown) {
          calls.push(["limit", params]);
          return {
            status: "ok",
            response: { data: { statuses: [{ resting: { oid: "limit-1" } }] } },
          };
        },
        async placeMarketOrder(params: unknown) {
          calls.push(["market", params]);
          return {
            status: "ok",
            response: { data: { statuses: [{ filled: { oid: "market-1" } }] } },
          };
        },
        async cancelOrder(params: unknown) {
          calls.push(["cancel", params]);
          return {
            status: "ok",
            response: {
              data: { statuses: [{ cancelled: { oid: "limit-1" } }] },
            },
          };
        },
        async cancelAll(params: unknown) {
          calls.push(["cancelAll", params]);
          return { status: "ok", response: { data: { statuses: [] } } };
        },
      },
      account: {
        async fills() {
          return [];
        },
      },
    };
    const gateway = new BulkOrderGateway(client, {
      market: "ETH-USD",
      accountId: "account",
    });

    const limit = await gateway.place({
      market: "ETH-USD",
      side: "buy",
      price: 100,
      qty: 0.01,
      reduceOnly: false,
      timeInForce: "GTC",
    });
    const market = await gateway.place({
      market: "ETH-USD",
      side: "sell",
      qty: 0.02,
      reduceOnly: true,
      timeInForce: "IOC",
    });
    const limitIoc = await gateway.place({
      market: "ETH-USD",
      side: "sell",
      price: 102,
      qty: 0.03,
      reduceOnly: false,
      timeInForce: "IOC",
    });
    await gateway.cancel("limit-1");
    await gateway.cancelAll();

    expect(limit).toMatchObject({ id: "limit-1", status: "open" });
    expect(market).toMatchObject({ id: "market-1", status: "filled" });
    expect(limitIoc).toMatchObject({ id: "limit-1", status: "open" });
    expect(calls).toEqual([
      [
        "limit",
        {
          symbol: "ETH-USD",
          side: "buy",
          price: 100,
          size: 0.01,
          tif: "GTC",
          reduceOnly: false,
        },
      ],
      ["market", { symbol: "ETH-USD", side: "sell", size: 0.02, reduceOnly: true }],
      [
        "limit",
        {
          symbol: "ETH-USD",
          side: "sell",
          price: 102,
          size: 0.03,
          tif: "IOC",
          reduceOnly: false,
        },
      ],
      ["cancel", { symbol: "ETH-USD", orderId: "limit-1" }],
      ["cancelAll", { symbols: ["ETH-USD"] }],
    ]);
  });

  test("does not overwrite a tracked order intent from cancel events", async () => {
    const events: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async cancelOrder() {
            return {
              status: "ok",
              response: {
                data: { statuses: [{ cancelled: { oid: "reduce-1" } }] },
              },
            };
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );
    gateway.subscribeOrderEvents((event) => {
      events.push(event);
    });

    await gateway.cancel("reduce-1");

    expect(events).toHaveLength(1);
    const cancelEvent = events[0] as Record<string, unknown>;
    expect(cancelEvent).toMatchObject({
      action: "cancel",
      orderId: "reduce-1",
    });
    expect(cancelEvent).not.toHaveProperty("intent");
  });

  test("aligns Bulk limit orders to exchange price and size increments before submission", async () => {
    const calls: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        market: {
          async exchangeInfo() {
            return [
              {
                symbol: "BTC-USD",
                pricePrecision: 3,
                sizePrecision: 6,
                tickSize: 0.001,
                lotSize: 0.000001,
                timeInForces: ["GTC", "IOC"],
              },
            ];
          },
        },
        trade: {
          async placeLimitOrder(params: unknown) {
            calls.push(params);
            return {
              status: "ok",
              response: { data: { statuses: [{ resting: { oid: "limit-1" } }] } },
            };
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );

    const bid = await gateway.place({
      market: "BTC-USD",
      side: "buy",
      price: 81_532.123456,
      qty: 0.003066279427,
      reduceOnly: false,
      timeInForce: "GTC",
    });
    const ask = await gateway.place({
      market: "BTC-USD",
      side: "sell",
      price: 81_532.123456,
      qty: 0.003066279427,
      reduceOnly: false,
      timeInForce: "GTC",
    });

    expect(bid.request).toMatchObject({ price: 81_532.123, qty: 0.003066 });
    expect(ask.request).toMatchObject({ price: 81_532.124, qty: 0.003066 });
    expect(calls).toEqual([
      {
        symbol: "BTC-USD",
        side: "buy",
        price: 81_532.123,
        size: 0.003066,
        tif: "GTC",
        reduceOnly: false,
      },
      {
        symbol: "BTC-USD",
        side: "sell",
        price: 81_532.124,
        size: 0.003066,
        tif: "GTC",
        reduceOnly: false,
      },
    ]);
  });

  test("allows ALO even when exchangeInfo omits it from timeInForces", async () => {
    const calls: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        market: {
          async exchangeInfo() {
            return [
              {
                symbol: "BTC-USD",
                pricePrecision: 3,
                sizePrecision: 6,
                tickSize: 0.001,
                lotSize: 0.000001,
                timeInForces: ["GTC", "IOC"],
              },
            ];
          },
        },
        trade: {
          async placeLimitOrder(params: unknown) {
            calls.push(params);
            return {
              status: "ok",
              response: { data: { statuses: [{ resting: { oid: "alo-1" } }] } },
            };
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );

    const placed = await gateway.place({
      market: "BTC-USD",
      side: "buy",
      price: 81_532.123456,
      qty: 0.003066279427,
      reduceOnly: false,
      timeInForce: "ALO",
    });

    expect(placed).toMatchObject({
      id: "alo-1",
      request: { price: 81_532.123, qty: 0.003066, timeInForce: "ALO" },
      status: "open",
    });
    expect(calls).toEqual([
      {
        symbol: "BTC-USD",
        side: "buy",
        price: 81_532.123,
        size: 0.003066,
        tif: "ALO",
        reduceOnly: false,
      },
    ]);
  });

  test("rounds reduce-only dust size up to the minimum Bulk lot for close orders", async () => {
    const calls: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        market: {
          async exchangeInfo() {
            return [
              {
                symbol: "BTC-USD",
                sizePrecision: 6,
                lotSize: 0.000001,
                timeInForces: ["IOC"],
              },
            ];
          },
        },
        trade: {
          async placeMarketOrder(params: unknown) {
            calls.push(params);
            return {
              status: "ok",
              response: { data: { statuses: [{ filled: { oid: "dust-close" } }] } },
            };
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );

    const placed = await gateway.place({
      market: "BTC-USD",
      side: "sell",
      qty: 6.299999998349293e-7,
      reduceOnly: true,
      timeInForce: "IOC",
      intent: "close",
    });

    expect(placed).toMatchObject({
      id: "dust-close",
      request: { qty: 0.000001, reduceOnly: true },
      status: "filled",
    });
    expect(calls).toEqual([{ symbol: "BTC-USD", side: "sell", size: 0.000001, reduceOnly: true }]);
  });

  test("allows reduce-only limit orders below min notional so tiny inventory can be reduced", async () => {
    const calls: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        market: {
          async exchangeInfo() {
            return [
              {
                symbol: "BTC-USD",
                pricePrecision: 1,
                sizePrecision: 6,
                lotSize: 0.000001,
                minNotional: 1,
                timeInForces: ["GTC"],
              },
            ];
          },
        },
        trade: {
          async placeLimitOrder(params: unknown) {
            calls.push(params);
            return {
              status: "ok",
              response: { data: { statuses: [{ resting: { oid: "reduce-dust" } }] } },
            };
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );

    const placed = await gateway.place({
      market: "BTC-USD",
      side: "sell",
      price: 79_940.435,
      qty: 0.000001,
      reduceOnly: true,
      timeInForce: "GTC",
      intent: "reduce",
    });

    expect(placed).toMatchObject({
      id: "reduce-dust",
      request: { price: 79_940.4, qty: 0.000001, reduceOnly: true },
      status: "open",
    });
    expect(calls).toEqual([
      {
        symbol: "BTC-USD",
        side: "sell",
        price: 79_940.4,
        size: 0.000001,
        tif: "GTC",
        reduceOnly: true,
      },
    ]);
  });

  test("logs order submission, cancellations, and new fills", async () => {
    const logs = captureLogs();
    const client = {
      trade: {
        async placeLimitOrder() {
          return {
            status: "ok",
            response: { data: { statuses: [{ resting: { oid: "limit-1" } }] } },
          };
        },
        async cancelOrder() {
          return {
            status: "ok",
            response: {
              data: { statuses: [{ cancelled: { oid: "limit-1" } }] },
            },
          };
        },
        async cancelAll() {
          return { status: "ok", response: { data: { statuses: [] } } };
        },
      },
      account: {
        async fills() {
          return [
            {
              maker: "account",
              taker: "other",
              orderIdMaker: "limit-1",
              isBuy: true,
              symbol: "BTC-USD",
              amount: 0.1,
              price: 100,
              timestamp: 1_700_000_000_000 * 1_000_000,
            },
          ];
        },
      },
    };
    try {
      const gateway = new BulkOrderGateway(client, {
        market: "BTC-USD",
        accountId: "account",
      });
      gateway.subscribeFills(async () => {});

      await gateway.place({
        market: "BTC-USD",
        side: "buy",
        price: 100,
        qty: 0.1,
        reduceOnly: false,
        timeInForce: "GTC",
      });
      await gateway.cancel("limit-1");
      await gateway.cancelAll();
      await gateway.pollFillsOnce();

      expect(logs.messages).toContain(
        "bulk_order_gateway.place_submitted market=BTC-USD type=limit side=buy qty=0.1 price=100 tif=GTC reduceOnly=false",
      );
      expect(logs.messages).toContain(
        "bulk_order_gateway.place_result market=BTC-USD orderId=limit-1 status=open statusKey=resting",
      );
      expect(logs.messages).toContain(
        "bulk_order_gateway.cancel_submitted market=BTC-USD orderId=limit-1",
      );
      expect(logs.messages).toContain("bulk_order_gateway.cancel_all_submitted market=BTC-USD");
      expect(logs.messages).toContain(
        "bulk_order_gateway.fill_received market=BTC-USD orderId=limit-1 side=sell qty=0.1 price=100",
      );
    } finally {
      logs.restore();
    }
  });

  test("rejects the first order when Bulk account leverage exceeds the configured max", async () => {
    const calls: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async placeLimitOrder(params: unknown) {
            calls.push(["limit", params]);
            return {
              status: "ok",
              response: { data: { statuses: [{ resting: { oid: "limit-1" } }] } },
            };
          },
        },
        account: {
          async fullAccount() {
            calls.push(["fullAccount"]);
            return { leverageSettings: [{ symbol: "BTC-USD", leverage: 50 }] };
          },
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account", maxLeverage: 5 },
    );

    await gateway
      .place({
        market: "BTC-USD",
        side: "buy",
        price: 100,
        qty: 0.01,
        reduceOnly: false,
        timeInForce: "GTC",
      })
      .then(
        () => {
          throw new Error("Expected Bulk leverage guard to reject");
        },
        (error) => {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe(
            "Bulk leverage for BTC-USD is 50x; expected <= 5x. Set leverage in Bulk UI or a supported API path before starting live orders.",
          );
        },
      );

    expect(calls).toEqual([["fullAccount"]]);
  });

  test("allows reduce-only limit close orders when Bulk account leverage exceeds the configured max", async () => {
    const calls: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async placeLimitOrder(params: unknown) {
            calls.push(["limit", params]);
            return {
              status: "ok",
              response: { data: { statuses: [{ filled: { oid: "close-1" } }] } },
            };
          },
        },
        account: {
          async fullAccount() {
            calls.push(["fullAccount"]);
            return { leverageSettings: [{ symbol: "BTC-USD", leverage: 50 }] };
          },
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account", maxLeverage: 5 },
    );

    const placed = await gateway.place({
      market: "BTC-USD",
      side: "sell",
      price: 81324.75,
      qty: 0.4,
      reduceOnly: true,
      timeInForce: "IOC",
    });

    expect(placed).toMatchObject({ id: "close-1", status: "filled" });
    expect(calls).toEqual([
      [
        "limit",
        {
          symbol: "BTC-USD",
          side: "sell",
          price: 81324.75,
          size: 0.4,
          tif: "IOC",
          reduceOnly: true,
        },
      ],
    ]);
  });

  test("reads the current non-isolated Bulk position from fullAccount", async () => {
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fullAccount() {
            return {
              positions: [
                { symbol: "ETH-USD", size: -1, price: 2000, unrealizedPnl: 3 },
                { symbol: "BTC-USD", size: 0.02, price: 81000, unrealizedPnl: 12, iso: false },
                { symbol: "BTC-USD", size: 0.5, price: 80000, unrealizedPnl: 1, iso: true },
              ],
            };
          },
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );

    const position = await gateway.getPosition();
    expect(position).toEqual({
      qty: 0.02,
      avgEntry: 81000,
      unrealizedPnl: 12,
    });
  });

  test("normalizes Bulk open orders for exchange-truth reconciliation", async () => {
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async openOrders() {
            return [
              {
                symbol: "BTC-USD",
                orderId: "buy-1",
                price: 100_000,
                size: 0.04,
                reduceOnly: false,
                tif: "gtc",
                status: "resting",
                timestamp: 1_700_000_000_000_000_000,
              },
              {
                symbol: "BTC-USD",
                orderId: "sell-1",
                price: 100_100,
                size: -0.02,
                reduceOnly: true,
                tif: "ioc",
                status: "partiallyFilled",
                timestamp: 1_700_000_000_100,
              },
              {
                symbol: "ETH-USD",
                orderId: "other-market",
                price: 4_000,
                size: 1,
                status: "resting",
              },
              {
                symbol: "BTC-USD",
                orderId: "filled",
                price: 100_100,
                size: -0.02,
                status: "filled",
              },
            ];
          },
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );

    const orders = await gateway.getOpenOrders();

    expect(orders).toEqual([
      {
        id: "buy-1",
        market: "BTC-USD",
        side: "buy",
        price: 100_000,
        qty: 0.04,
        reduceOnly: false,
        timeInForce: "GTC",
        status: "open",
        placedAtMs: 1_700_000_000_000,
      },
      {
        id: "sell-1",
        market: "BTC-USD",
        side: "sell",
        price: 100_100,
        qty: 0.02,
        reduceOnly: true,
        timeInForce: "IOC",
        status: "partially_filled",
        placedAtMs: 1_700_000_000_100,
      },
    ]);
  });

  test("places orders when Bulk account leverage is within the configured max", async () => {
    const calls: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async placeLimitOrder(params: unknown) {
            calls.push(["limit", params]);
            return {
              status: "ok",
              response: { data: { statuses: [{ resting: { oid: "limit-1" } }] } },
            };
          },
        },
        account: {
          async fullAccount() {
            calls.push(["fullAccount"]);
            return { leverageSettings: [{ symbol: "BTC-USD", leverage: 5 }] };
          },
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account", maxLeverage: 5 },
    );

    await gateway.place({
      market: "BTC-USD",
      side: "buy",
      price: 100,
      qty: 0.01,
      reduceOnly: false,
      timeInForce: "GTC",
    });
    await gateway.place({
      market: "BTC-USD",
      side: "sell",
      price: 101,
      qty: 0.01,
      reduceOnly: false,
      timeInForce: "GTC",
    });

    expect(calls).toEqual([
      ["fullAccount"],
      [
        "limit",
        {
          symbol: "BTC-USD",
          side: "buy",
          price: 100,
          size: 0.01,
          tif: "GTC",
          reduceOnly: false,
        },
      ],
      [
        "limit",
        {
          symbol: "BTC-USD",
          side: "sell",
          price: 101,
          size: 0.01,
          tif: "GTC",
          reduceOnly: false,
        },
      ],
    ]);
  });

  test("returns rejected placed order when SDK statuses reject the action", async () => {
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async placeLimitOrder() {
            return {
              status: "ok",
              response: {
                data: {
                  statuses: [{ rejectedInvalid: { oid: "bad-1", reason: "bad size" } }],
                },
              },
            };
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "ETH-USD", accountId: "account" },
    );

    const placed = await gateway.place({
      market: "ETH-USD",
      side: "buy",
      price: 100,
      qty: 0.01,
      reduceOnly: false,
      timeInForce: "GTC",
    });

    expect(placed).toMatchObject({ id: "bad-1", status: "rejected" });
  });

  test("returns rejected placed order when Bulk responds with HTTP 422", async () => {
    const events: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async placeLimitOrder() {
            const error = new Error("HTTP error 422");
            Object.assign(error, { name: "BulkHttpError", status: 422 });
            throw error;
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );
    gateway.subscribeOrderEvents((event) => {
      events.push(event);
    });

    const placed = await gateway.place({
      market: "BTC-USD",
      side: "sell",
      price: 81_349,
      qty: 0.003073,
      reduceOnly: false,
      timeInForce: "GTC",
      clientOrderId: "quote-1",
    });

    expect(placed).toEqual({
      id: "quote-1",
      request: {
        market: "BTC-USD",
        side: "sell",
        price: 81_349,
        qty: 0.003073,
        reduceOnly: false,
        timeInForce: "GTC",
        clientOrderId: "quote-1",
      },
      status: "rejected",
    });
    expect(events).toMatchObject([
      { action: "submit", side: "sell", price: 81_349, qty: 0.003073 },
      {
        action: "reject",
        orderId: "quote-1",
        status: "rejected",
        statusKey: "http_422",
        reason: "HTTP error 422",
      },
    ]);
  });

  test("returns rejected placed order when Bulk responds with HTTP 408", async () => {
    const events: unknown[] = [];
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async placeLimitOrder() {
            const error = new Error("HTTP request timed out");
            Object.assign(error, { name: "BulkTimeoutError", status: 408 });
            throw error;
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account" },
    );
    gateway.subscribeOrderEvents((event) => {
      events.push(event);
    });

    const placed = await gateway.place({
      market: "BTC-USD",
      side: "sell",
      price: 81_349,
      qty: 0.003073,
      reduceOnly: true,
      timeInForce: "IOC",
      clientOrderId: "reduce-1",
      intent: "reduce",
    });

    expect(placed.status).toBe("rejected");
    expect(events).toMatchObject([
      { action: "submit", intent: "reduce", side: "sell" },
      {
        action: "reject",
        orderId: "reduce-1",
        status: "rejected",
        statusKey: "http_408",
        reason: "HTTP request timed out",
      },
    ]);
  });

  test("serializes scheduled fill polling and waits for the in-flight poll on dispose", async () => {
    let calls = 0;
    let started: (() => void) | undefined;
    let release: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fills() {
            calls += 1;
            started?.();
            await releasePromise;
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account", pollIntervalMs: 1 },
    );

    await startedPromise;
    await Bun.sleep(5);
    expect(calls).toBe(1);

    let disposed = false;
    const disposePromise = Promise.resolve(gateway.dispose()).then(() => {
      disposed = true;
    });
    await Bun.sleep(5);
    expect(disposed).toBe(false);

    release?.();
    await disposePromise;
    const callsAfterDispose = calls;
    await Bun.sleep(5);

    expect(disposed).toBe(true);
    expect(calls).toBe(callsAfterDispose);
  });

  test("stops scheduled fill polling without waiting for the in-flight poll", async () => {
    let release: (() => void) | undefined;
    const startedPromise = Promise.withResolvers<void>();
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fills() {
            startedPromise.resolve();
            await releasePromise;
            return [];
          },
        },
      },
      { market: "BTC-USD", accountId: "account", pollIntervalMs: 1 },
    );

    await startedPromise.promise;

    const stopped = Promise.resolve(gateway.stopBackgroundSync()).then(() => "stopped" as const);
    const result = await Promise.race([stopped, Bun.sleep(10).then(() => "blocked" as const)]);
    release?.();
    await stopped;
    await gateway.dispose();

    expect(result).toBe("stopped");
  });

  test("logs scheduled Bulk account timeouts as recoverable polling warnings", async () => {
    const logs = captureWarnAndErrorLogs();
    let calls = 0;
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fills() {
            calls += 1;
            const error = new Error("HTTP request timed out: POST /account");
            error.name = "BulkTimeoutError";
            throw error;
          },
        },
      },
      { market: "BTC-USD", accountId: "account", pollIntervalMs: 1 },
    );

    try {
      await Bun.sleep(10);
      await gateway.dispose();
    } finally {
      logs.restore();
    }

    expect(calls).toBeGreaterThan(0);
    expect(
      logs.warnMessages.some((message) => message.includes("fills_poll_transient_failed")),
    ).toBe(true);
    expect(logs.errorMessages).toEqual([]);
  });

  test("does not report Bulk partial fills as fully filled orders", async () => {
    const gateway = new BulkOrderGateway(
      {
        trade: {
          async placeLimitOrder() {
            return {
              status: "ok",
              response: {
                data: { statuses: [{ partiallyFilled: { oid: "partial-1" } }] },
              },
            };
          },
        },
        account: {
          async fills() {
            return [];
          },
        },
      },
      { market: "ETH-USD", accountId: "account" },
    );

    const placed = await gateway.place({
      market: "ETH-USD",
      side: "sell",
      price: 100,
      qty: 0.01,
      reduceOnly: true,
      timeInForce: "IOC",
    });

    expect(placed).toMatchObject({ id: "partial-1", status: "partially_filled" });
  });

  test("normalizes maker and taker fills for buy and sell sides", async () => {
    const client = {
      trade: {},
      account: {
        async fills() {
          return [
            {
              maker: "account",
              taker: "other",
              orderIdMaker: "maker-sell",
              isBuy: true,
              symbol: "ETH-USD",
              amount: 0.1,
              price: 100,
              fee: -0.01,
              timestamp: 1_700_000_000_000 * 1_000_000,
            },
            {
              maker: "other",
              taker: "account",
              orderIdTaker: "taker-sell",
              isBuy: false,
              symbol: "ETH-USD",
              amount: 0.2,
              price: 99,
              fee: 0.02,
              timestamp: 1_700_000_001_000 * 1_000_000,
            },
          ];
        },
      },
    };
    const gateway = new BulkOrderGateway(client, {
      market: "ETH-USD",
      accountId: "account",
    });
    const fills: unknown[] = [];
    gateway.subscribeFills((fill) => {
      fills.push(fill);
    });

    await gateway.pollFillsOnce();

    expect(fills).toEqual([
      {
        id: "maker-sell:unknown:1700000000000000000",
        venue: "bulk",
        market: "ETH-USD",
        side: "sell",
        price: 100,
        qty: 0.1,
        fee: -0.01,
        tradePnl: 0,
        filledAt: 1_700_000_000_000,
        quoteId: "maker-sell",
        markPriceAtFill: 100,
        makerTaker: "maker",
      },
      {
        id: "taker-sell:unknown:1700000001000000000",
        venue: "bulk",
        market: "ETH-USD",
        side: "sell",
        price: 99,
        qty: 0.2,
        fee: 0.02,
        tradePnl: 0,
        filledAt: 1_700_000_001_000,
        quoteId: "taker-sell",
        markPriceAtFill: 99,
        makerTaker: "taker",
      },
    ]);
  });

  test("ignores fills older than the startup watermark", async () => {
    const client = {
      trade: {},
      account: {
        async fills() {
          return [
            {
              maker: "account",
              taker: "other",
              orderIdMaker: "old-maker",
              isBuy: true,
              symbol: "ETH-USD",
              amount: 0.1,
              price: 100,
              timestamp: 1_700_000_000_000 * 1_000_000,
            },
            {
              maker: "account",
              taker: "other",
              orderIdMaker: "new-maker",
              isBuy: true,
              symbol: "ETH-USD",
              amount: 0.2,
              price: 101,
              timestamp: 1_700_000_001_000 * 1_000_000,
            },
          ];
        },
      },
    };
    const gateway = new BulkOrderGateway(client, {
      market: "ETH-USD",
      accountId: "account",
      ignoreFillsBeforeMs: 1_700_000_000_500,
    });
    const fills: unknown[] = [];
    gateway.subscribeFills((fill) => {
      fills.push(fill);
    });

    await gateway.pollFillsOnce();

    expect(fills).toMatchObject([
      {
        quoteId: "new-maker",
        qty: 0.2,
        filledAt: 1_700_000_001_000,
      },
    ]);
  });

  test("does not retain ignored historical fill ids in the long-running dedupe cache", async () => {
    const oldTimestamp = 1_700_000_000_000;
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fills() {
            return [
              {
                maker: "account",
                taker: "other",
                orderIdMaker: "old-maker",
                orderIdTaker: "old-taker",
                isBuy: true,
                symbol: "BTC-USD",
                amount: 0.1,
                price: 100,
                timestamp: oldTimestamp,
              },
            ];
          },
        },
      },
      {
        market: "BTC-USD",
        accountId: "account",
        ignoreFillsBeforeMs: oldTimestamp + 1,
      },
    );

    await gateway.pollFillsOnce();

    expect((gateway as unknown as { seenFillIds: { size: number } }).seenFillIds.size).toBe(0);
  });

  test("bounds the seen fill id cache during long-running polling", async () => {
    let poll = 0;
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fills() {
            poll += 1;
            return [
              {
                maker: "account",
                taker: "other",
                orderIdMaker: `maker-${poll}`,
                orderIdTaker: `taker-${poll}`,
                isBuy: true,
                symbol: "BTC-USD",
                amount: 0.1,
                price: 100,
                timestamp: 1_700_000_000_000 + poll,
              },
            ];
          },
        },
      },
      {
        market: "BTC-USD",
        accountId: "account",
        maxSeenFillIds: 2,
      },
    );

    await gateway.pollFillsOnce();
    await gateway.pollFillsOnce();
    await gateway.pollFillsOnce();

    expect((gateway as unknown as { seenFillIds: { size: number } }).seenFillIds.size).toBe(2);
  });

  test("evicts oldest fill timestamps when the seen fill id cache is full", async () => {
    const fills = [
      { orderIdMaker: "newest-maker", timestamp: 1_700_000_003_000 },
      { orderIdMaker: "oldest-maker", timestamp: 1_700_000_001_000 },
      { orderIdMaker: "middle-maker", timestamp: 1_700_000_002_000 },
    ];
    let poll = 0;
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fills() {
            const fill = fills[poll];
            if (fill === undefined) {
              throw new Error("unexpected fill poll");
            }
            poll += 1;
            return [
              {
                maker: "account",
                taker: "other",
                orderIdMaker: fill.orderIdMaker,
                orderIdTaker: `${fill.orderIdMaker}-taker`,
                isBuy: true,
                symbol: "BTC-USD",
                amount: 0.1,
                price: 100,
                timestamp: fill.timestamp,
              },
            ];
          },
        },
      },
      {
        market: "BTC-USD",
        accountId: "account",
        maxSeenFillIds: 2,
      },
    );

    await gateway.pollFillsOnce();
    await gateway.pollFillsOnce();
    await gateway.pollFillsOnce();

    const seenFillIds = (gateway as unknown as { seenFillIds: Map<string, number> }).seenFillIds;
    expect([...seenFillIds.keys()]).toEqual([
      expect.stringContaining("newest-maker"),
      expect.stringContaining("middle-maker"),
    ]);
  });

  test("prunes out-of-order fill ids against the newest observed fill timestamp", async () => {
    const newestTimestamp = 1_700_000_010_000;
    const staleTimestamp = newestTimestamp - 2_000;
    let poll = 0;
    const gateway = new BulkOrderGateway(
      {
        trade: {},
        account: {
          async fills() {
            poll += 1;
            return [
              {
                maker: "account",
                taker: "other",
                orderIdMaker: poll === 1 ? "new-maker" : "stale-maker",
                orderIdTaker: poll === 1 ? "new-taker" : "stale-taker",
                isBuy: true,
                symbol: "BTC-USD",
                amount: 0.1,
                price: 100,
                timestamp: poll === 1 ? newestTimestamp : staleTimestamp,
              },
            ];
          },
        },
      },
      {
        market: "BTC-USD",
        accountId: "account",
        seenFillTtlMs: 1_000,
      },
    );

    await gateway.pollFillsOnce();
    await gateway.pollFillsOnce();

    const seenFillIds = (gateway as unknown as { seenFillIds: Map<string, number> }).seenFillIds;
    expect([...seenFillIds.keys()]).toEqual([expect.stringContaining("new-maker")]);
  });

  test("keeps split fills with the same account order and timestamp distinct", async () => {
    const client = {
      trade: {},
      account: {
        async fills() {
          return [
            {
              maker: "maker-a",
              taker: "account",
              orderIdMaker: "maker-a-order",
              orderIdTaker: "taker-order",
              isBuy: true,
              symbol: "BTC-USD",
              amount: 0.25,
              price: 100,
              timestamp: 1_700_000_000_000 * 1_000_000,
            },
            {
              maker: "maker-b",
              taker: "account",
              orderIdMaker: "maker-b-order",
              orderIdTaker: "taker-order",
              isBuy: true,
              symbol: "BTC-USD",
              amount: 2.5,
              price: 100,
              timestamp: 1_700_000_000_000 * 1_000_000,
            },
          ];
        },
      },
    };
    const gateway = new BulkOrderGateway(client, {
      market: "BTC-USD",
      accountId: "account",
    });
    const fills: unknown[] = [];
    gateway.subscribeFills((fill) => {
      fills.push(fill);
    });

    await gateway.pollFillsOnce();

    expect(fills).toMatchObject([
      {
        id: "taker-order:maker-a-order:1700000000000000000",
        quoteId: "taker-order",
        qty: 0.25,
      },
      {
        id: "taker-order:maker-b-order:1700000000000000000",
        quoteId: "taker-order",
        qty: 2.5,
      },
    ]);
  });
});
