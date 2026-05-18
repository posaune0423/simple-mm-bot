import { describe, expect, test } from "bun:test";

import { ExternalMarketSubscriptionService } from "../../../src/application/services/ExternalMarketSubscriptionService.ts";
import type { ExternalTopOfBookUpdate } from "../../../src/domain/external-market/ExternalMarketTypes.ts";
import type { IExternalMarketSubscription } from "../../../src/domain/ports/IExternalMarketSubscription.ts";
import type { IExternalMarketTopOfBookWriter } from "../../../src/domain/ports/IExternalMarketTopOfBookStore.ts";

describe("ExternalMarketSubscriptionService", () => {
  test("starts subscriptions and forwards top-of-book updates to writer", () => {
    const subscription = new FakeSubscription("binance_usdm", "BTCUSDT");
    const writer = new FakeTopOfBookWriter();
    const service = new ExternalMarketSubscriptionService([subscription], writer);

    service.start();
    subscription.emit(topOfBook({ bidPrice: 99, askPrice: 101 }));

    expect(subscription.startCount).toBe(1);
    expect(writer.updates).toHaveLength(1);
    expect(writer.updates[0]).toMatchObject({ venue: "binance_usdm", symbol: "BTCUSDT" });
  });

  test("keeps starting other subscriptions when one subscription throws", () => {
    const failing = new FakeSubscription("binance_usdm", "BTCUSDT", { failStart: true });
    const healthy = new FakeSubscription("okx_swap", "BTC-USDT-SWAP");
    const service = new ExternalMarketSubscriptionService(
      [failing, healthy],
      new FakeTopOfBookWriter(),
    );

    service.start();

    expect(failing.startCount).toBe(1);
    expect(healthy.startCount).toBe(1);
  });

  test("stop calls every subscription once and is idempotent", () => {
    const first = new FakeSubscription("binance_usdm", "BTCUSDT");
    const second = new FakeSubscription("okx_swap", "BTC-USDT-SWAP");
    const service = new ExternalMarketSubscriptionService(
      [first, second],
      new FakeTopOfBookWriter(),
    );

    service.start();
    service.stop();
    service.stop();

    expect(first.stopCount).toBe(1);
    expect(second.stopCount).toBe(1);
  });
});

class FakeTopOfBookWriter implements IExternalMarketTopOfBookWriter {
  readonly updates: ExternalTopOfBookUpdate[] = [];

  update(update: ExternalTopOfBookUpdate): boolean {
    this.updates.push(update);
    return true;
  }
}

class FakeSubscription implements IExternalMarketSubscription {
  startCount = 0;
  stopCount = 0;
  private handlers: Parameters<IExternalMarketSubscription["start"]>[0] | undefined;

  constructor(
    readonly venue: IExternalMarketSubscription["venue"],
    readonly symbol: string,
    private readonly options: { failStart?: boolean } = {},
  ) {}

  start(handlers: Parameters<IExternalMarketSubscription["start"]>[0]): void {
    this.startCount += 1;
    this.handlers = handlers;
    if (this.options.failStart === true) {
      throw new Error("start failed");
    }
  }

  stop(): void {
    this.stopCount += 1;
  }

  emit(update: ExternalTopOfBookUpdate): void {
    this.handlers?.onTopOfBook(update);
  }
}

function topOfBook(overrides: Partial<ExternalTopOfBookUpdate> = {}): ExternalTopOfBookUpdate {
  return {
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    receivedAt: 1_700_000_000_001,
    bidPrice: 99,
    bidSize: 1,
    askPrice: 101,
    askSize: 1,
    ...overrides,
  };
}
