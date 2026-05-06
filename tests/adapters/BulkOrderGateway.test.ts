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
        id: "maker-sell:1700000000000000000",
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
      },
      {
        id: "taker-sell:1700000001000000000",
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
      },
    ]);
  });
});
