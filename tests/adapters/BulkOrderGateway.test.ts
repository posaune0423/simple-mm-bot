import { describe, expect, test } from "bun:test";

import { BulkOrderGateway } from "../../src/adapters/bulk/BulkOrderGateway.ts";

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
            response: { data: { statuses: [{ cancelled: { oid: "limit-1" } }] } },
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
    const gateway = new BulkOrderGateway(client, { market: "ETH-USD", accountId: "account" });

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
        { symbol: "ETH-USD", side: "buy", price: 100, size: 0.01, tif: "GTC", reduceOnly: false },
      ],
      ["market", { symbol: "ETH-USD", side: "sell", size: 0.02, reduceOnly: true }],
      [
        "limit",
        { symbol: "ETH-USD", side: "sell", price: 102, size: 0.03, tif: "IOC", reduceOnly: false },
      ],
      ["cancel", { symbol: "ETH-USD", orderId: "limit-1" }],
      ["cancelAll", { symbols: ["ETH-USD"] }],
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
                data: { statuses: [{ rejectedInvalid: { oid: "bad-1", reason: "bad size" } }] },
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
    const gateway = new BulkOrderGateway(client, { market: "ETH-USD", accountId: "account" });
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
