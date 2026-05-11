import { describe, expect, test } from "bun:test";

import { SyncPositionUseCase } from "../../../src/application/usecases/SyncPositionUseCase.ts";
import type { Position } from "../../../src/domain/entities/Position.ts";
import type { IOrderGateway } from "../../../src/domain/ports/IOrderGateway.ts";
import { InMemoryPositionRepository } from "../../../src/infrastructure/InMemoryPositionRepository.ts";

describe("SyncPositionUseCase", () => {
  test("replaces fill-derived position with the exchange account position", async () => {
    const repository = new InMemoryPositionRepository();
    await repository.set({ qty: 0.247647, avgEntry: 81_756.75, unrealizedPnl: 0 });

    const result = await new SyncPositionUseCase(
      orderGateway({ qty: 0, avgEntry: 0, unrealizedPnl: 0 }),
      repository,
    ).execute();

    expect(result).toEqual({
      synced: true,
      previous: { qty: 0.247647, avgEntry: 81_756.75, unrealizedPnl: 0 },
      current: { qty: 0, avgEntry: 0, unrealizedPnl: 0 },
      deltaQty: -0.247647,
    });
    expect(await repository.get()).toEqual({ qty: 0, avgEntry: 0, unrealizedPnl: 0 });
  });

  test("is a no-op when the gateway cannot read account position", async () => {
    const repository = new InMemoryPositionRepository();
    await repository.set({ qty: -0.1, avgEntry: 82_000, unrealizedPnl: 3 });

    const result = await new SyncPositionUseCase(orderGateway(), repository).execute();

    expect(result).toEqual({
      synced: false,
      previous: { qty: -0.1, avgEntry: 82_000, unrealizedPnl: 3 },
      current: { qty: -0.1, avgEntry: 82_000, unrealizedPnl: 3 },
      deltaQty: 0,
    });
    expect(await repository.get()).toEqual({ qty: -0.1, avgEntry: 82_000, unrealizedPnl: 3 });
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
