import { describe, expect, test } from "bun:test";

import { ExternalMarketSubscriptionService } from "../../../src/application/services/ExternalMarketSubscriptionService.ts";
import type { ExternalTopOfBookUpdate } from "../../../src/domain/external-market/ExternalMarketTypes.ts";
import type { FairValueSnapshot } from "../../../src/domain/external-market/FairValueTypes.ts";
import type { IFairValueProvider } from "../../../src/domain/ports/IFairValueProvider.ts";
import type { IExternalMarketSubscription } from "../../../src/domain/ports/IExternalMarketSubscription.ts";
import type { IExternalMarketTopOfBookWriter } from "../../../src/domain/ports/IExternalMarketTopOfBookStore.ts";

describe("ExternalMarketSubscriptionService", () => {
  test("starts subscriptions and forwards top-of-book updates to writer", async () => {
    const subscription = new FakeSubscription("binance_usdm", "BTCUSDT");
    const writer = new FakeTopOfBookWriter();
    const service = new ExternalMarketSubscriptionService([subscription], writer);

    await service.start();
    subscription.emit(topOfBook({ bidPrice: 99, askPrice: 101 }));

    expect(subscription.startCount).toBe(1);
    expect(writer.updates).toHaveLength(1);
    expect(writer.updates[0]).toMatchObject({ venue: "binance_usdm", symbol: "BTCUSDT" });
  });

  test("keeps starting other subscriptions when one subscription throws", async () => {
    const failing = new FakeSubscription("binance_usdm", "BTCUSDT", { failStart: true });
    const healthy = new FakeSubscription("okx_swap", "BTC-USDT-SWAP");
    const service = new ExternalMarketSubscriptionService(
      [failing, healthy],
      new FakeTopOfBookWriter(),
    );

    await service.start();

    expect(failing.startCount).toBe(1);
    expect(healthy.startCount).toBe(1);
  });

  test("stop calls every subscription once and is idempotent", async () => {
    const first = new FakeSubscription("binance_usdm", "BTCUSDT");
    const second = new FakeSubscription("okx_swap", "BTC-USDT-SWAP");
    const service = new ExternalMarketSubscriptionService(
      [first, second],
      new FakeTopOfBookWriter(),
    );

    await service.start();
    await service.stop();
    await service.stop();

    expect(first.stopCount).toBe(1);
    expect(second.stopCount).toBe(1);
  });

  test("waits for a usable fair value snapshot during warmup", async () => {
    const subscription = new FakeSubscription("binance_usdm", "BTCUSDT");
    const writer = new FakeTopOfBookWriter();
    const provider = new FakeFairValueProvider();
    const service = new ExternalMarketSubscriptionService([subscription], writer, {
      provider,
      timeoutMs: 100,
      pollIntervalMs: 1,
    });

    const started = service.start();
    await waitUntil(() => provider.callCount > 0, "fair value provider poll");
    expect(provider.callCount).toBeGreaterThan(0);
    expect(writer.updates).toHaveLength(0);

    subscription.emit(topOfBook({ bidPrice: 99, askPrice: 101 }));
    provider.markReady();
    await started;

    expect(subscription.startCount).toBe(1);
  });

  test("cleans up subscriptions when warmup times out", async () => {
    const subscription = new FakeSubscription("binance_usdm", "BTCUSDT");
    const provider = new FakeFairValueProvider();
    const service = new ExternalMarketSubscriptionService(
      [subscription],
      new FakeTopOfBookWriter(),
      {
        provider,
        timeoutMs: 1,
        pollIntervalMs: 1,
      },
    );

    const failure = await service.start().then(
      () => {
        throw new Error("Expected warmup timeout");
      },
      (error) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("External fair value warmup timed out after 1ms");
    expect(subscription.startCount).toBe(1);
    expect(subscription.stopCount).toBe(1);

    provider.markReady();
    await service.start();

    expect(subscription.startCount).toBe(2);
    expect(subscription.stopCount).toBe(1);
  });

  test("returns cleanly when stopped during warmup", async () => {
    const subscription = new FakeSubscription("binance_usdm", "BTCUSDT");
    const provider = new FakeFairValueProvider();
    const service = new ExternalMarketSubscriptionService(
      [subscription],
      new FakeTopOfBookWriter(),
      {
        provider,
        timeoutMs: 100,
        pollIntervalMs: 1,
      },
    );

    const started = service.start();
    await waitUntil(() => provider.callCount > 0, "fair value provider poll");
    await service.stop();

    await started;
    expect(subscription.stopCount).toBe(1);
  });
});

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

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

class FakeFairValueProvider implements IFairValueProvider {
  callCount = 0;
  private ready = false;

  markReady(): void {
    this.ready = true;
  }

  getLatestFairValue(nowMs: number): FairValueSnapshot {
    this.callCount += 1;
    if (!this.ready) {
      return {
        status: "unavailable",
        computedAt: nowMs,
        used: [],
        excluded: [],
      };
    }
    return {
      status: "degraded",
      computedAt: nowMs,
      fairBid: 99,
      fairAsk: 101,
      fairMid: 100,
      minAgeMs: 1,
      maxAgeMs: 1,
      used: [
        {
          venue: "binance_usdm",
          symbol: "BTCUSDT",
          bidPrice: 99,
          askPrice: 101,
          midPrice: 100,
          ageMs: 1,
          spreadBps: 200,
          weight: 1,
        },
      ],
      excluded: [],
    };
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
