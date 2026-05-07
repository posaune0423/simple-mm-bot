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
