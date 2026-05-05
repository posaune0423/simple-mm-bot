import { describe, expect, test } from "bun:test";

import { Bot } from "../../src/application/Bot.ts";

describe("Bot", () => {
  test("stops immediately on emergency risk state", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "EMERGENCY_STOP" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        recordFill: {
          execute: async () => {
            calls.push("fill");
          },
        },
        reduceInventory: { executeIfNeeded: async () => false },
        buildReport: {
          execute: async () => ({
            id: "r1",
            mode: "paper" as const,
            venue: "hyperliquid",
            periodStart: 0,
            periodEnd: 1,
            metrics: {
              netPnl: 0,
              tradePnl: 0,
              markout5s: 0,
              markout30s: 0,
              maxDrawdown: 0,
              sharpe: 0,
              fillRate: 0,
            },
            equityCurve: [],
            fillAnalysis: { adverseSelectionCount: 0, fillCount: 0 },
          }),
        },
      },
      {
        async connect() {},
        async disconnect() {},
        async getSnapshot() {
          return {
            market: "ETH",
            bestBid: 99,
            bestAsk: 101,
            microPrice: 100,
            markPrice: 100,
            timestamp: 1,
            marginRatio: 0.01,
          };
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("should not place");
        },
        async cancel() {},
        async cancelAll() {
          calls.push("cancelAll");
        },
        subscribeFills() {
          return () => {};
        },
      },
      1,
    );

    await bot.start(1);

    expect(calls).toEqual(["cancelAll"]);
  });

  test("cleans up subscriptions and order gateway lifecycle after stopping", async () => {
    const calls: string[] = [];
    const bot = new Bot(
      {
        guardRisk: { execute: async () => "OK" as const },
        refreshQuotes: {
          execute: async () => {
            calls.push("refresh");
          },
        },
        recordFill: { execute: async () => {} },
        reduceInventory: { executeIfNeeded: async () => false },
        buildReport: {
          execute: async () => ({
            id: "r1",
            mode: "paper" as const,
            venue: "bulk",
            periodStart: 0,
            periodEnd: 1,
            metrics: {
              netPnl: 0,
              tradePnl: 0,
              markout5s: 0,
              markout30s: 0,
              maxDrawdown: 0,
              sharpe: 0,
              fillRate: 0,
            },
            equityCurve: [],
            fillAnalysis: { adverseSelectionCount: 0, fillCount: 0 },
          }),
        },
      },
      {
        async connect() {
          calls.push("connect");
        },
        async disconnect() {
          calls.push("disconnect");
        },
        async getSnapshot() {
          throw new Error("unused");
        },
        subscribe() {
          return () => {};
        },
      },
      {
        async place() {
          throw new Error("unused");
        },
        async cancel() {},
        async cancelAll() {},
        subscribeFills() {
          calls.push("subscribe");
          return () => {
            calls.push("unsubscribe");
          };
        },
        dispose() {
          calls.push("dispose");
        },
      },
      1,
    );

    await bot.start(1);

    expect(calls).toEqual([
      "connect",
      "subscribe",
      "refresh",
      "disconnect",
      "unsubscribe",
      "dispose",
    ]);
  });
});
