import { describe, expect, test } from "bun:test";

import { PaperOrderGateway } from "../../../src/adapters/paper/PaperOrderGateway.ts";
import type { MarketSnapshot, SnapshotListener } from "../../../src/domain/ports/IMarketFeed.ts";

class MemoryMarketFeed {
  private readonly listeners = new Set<SnapshotListener>();

  constructor(private snapshot: MarketSnapshot) {}

  async connect() {}

  async disconnect() {}

  async getSnapshot(): Promise<MarketSnapshot> {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    void listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(snapshot: MarketSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      void listener(snapshot);
    }
  }
}

describe("PaperOrderGateway", () => {
  test("publishes submit, ack, and fill order events for paper metrics", async () => {
    const feed = new MemoryMarketFeed({
      market: "BTC-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100,
      markPrice: 100,
      timestamp: 1000,
      marginRatio: null,
    });
    const gateway = new PaperOrderGateway(feed, 1);
    const events: unknown[] = [];
    gateway.subscribeOrderEvents((event) => {
      events.push(event);
    });

    await gateway.place({
      market: "BTC-USD",
      side: "buy",
      price: 101,
      qty: 1,
      reduceOnly: false,
      timeInForce: "GTC",
      clientOrderId: "client-1",
      intent: "quote",
    });

    expect(events).toEqual([
      expect.objectContaining({
        action: "submit",
        clientOrderId: "client-1",
        intent: "quote",
        orderType: "limit",
      }),
      expect.objectContaining({
        action: "ack",
        clientOrderId: "client-1",
        orderId: "client-1",
        status: "open",
      }),
      expect.objectContaining({
        action: "fill",
        clientOrderId: "client-1",
        orderId: "client-1",
        status: "filled",
      }),
    ]);
  });

  test("publishes cancelAll order event for lifecycle metrics", async () => {
    const feed = new MemoryMarketFeed({
      market: "BTC-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100,
      markPrice: 100,
      timestamp: 1000,
      marginRatio: null,
    });
    const gateway = new PaperOrderGateway(feed, 0);
    const events: unknown[] = [];
    gateway.subscribeOrderEvents((event) => {
      events.push(event);
    });

    await gateway.place({
      market: "BTC-USD",
      side: "buy",
      price: 99,
      qty: 1,
      reduceOnly: false,
      timeInForce: "GTC",
      clientOrderId: "client-1",
      intent: "quote",
    });
    await gateway.cancelAll();

    expect(events.at(-1)).toMatchObject({
      action: "cancel",
      rawSummary: { request: "cancelAll" },
    });
  });
});
