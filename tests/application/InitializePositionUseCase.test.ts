import { describe, expect, test } from "bun:test";

import { InitializePositionUseCase } from "../../src/application/usecases/InitializePositionUseCase.ts";
import type { Position } from "../../src/domain/entities/Position.ts";
import type { IOrderGateway } from "../../src/domain/ports/IOrderGateway.ts";
import { InMemoryPositionRepository } from "../../src/infrastructure/InMemoryPositionRepository.ts";

describe("InitializePositionUseCase", () => {
  test("seeds the in-memory position from the live order gateway", async () => {
    const repository = new InMemoryPositionRepository();
    const gateway = orderGateway({
      qty: -0.25,
      avgEntry: 80_000,
      unrealizedPnl: -12.5,
    });

    await new InitializePositionUseCase(gateway, repository).execute();

    expect(await repository.get()).toEqual({
      qty: -0.25,
      avgEntry: 80_000,
      unrealizedPnl: -12.5,
    });
  });

  test("is a no-op when the gateway cannot read positions", async () => {
    const repository = new InMemoryPositionRepository();

    await new InitializePositionUseCase(orderGateway(), repository).execute();

    expect(await repository.get()).toEqual({
      qty: 0,
      avgEntry: 0,
      unrealizedPnl: 0,
    });
  });

  test("retries transient Bulk position reads before seeding", async () => {
    const repository = new InMemoryPositionRepository();
    const calls: string[] = [];
    let attempts = 0;
    const gateway = {
      ...orderGateway(),
      async getPosition() {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("HTTP error 408"), {
            name: "BulkHttpError",
            status: 408,
          });
        }
        return { qty: 0.2, avgEntry: 80_000, unrealizedPnl: 5 };
      },
    };

    await new InitializePositionUseCase(gateway, repository, {
      retryAttempts: 2,
      retryDelayMs: 1,
      sleep: async () => {
        calls.push("sleep");
      },
    }).execute();

    expect(attempts).toBe(2);
    expect(calls).toEqual(["sleep"]);
    expect(await repository.get()).toEqual({
      qty: 0.2,
      avgEntry: 80_000,
      unrealizedPnl: 5,
    });
  });
});

function orderGateway(position?: Position): IOrderGateway {
  return {
    async place(order) {
      return { id: "order-1", request: order, status: "open" as const };
    },
    async cancel() {},
    async cancelAll() {},
    subscribeFills() {
      return () => {};
    },
    ...(position === undefined
      ? {}
      : {
          async getPosition() {
            return position;
          },
        }),
  };
}
