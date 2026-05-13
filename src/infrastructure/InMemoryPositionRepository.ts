import { match } from "ts-pattern";
import type { Fill } from "../domain/types/Fill.ts";
import { flatPosition } from "../domain/types/Position.ts";
import type { Position } from "../domain/types/Position.ts";
import type { IPositionRepository } from "../domain/ports/IPositionRepository.ts";

export class InMemoryPositionRepository implements IPositionRepository {
  private position: Position = { ...flatPosition };

  async get(): Promise<Position> {
    return { ...this.position };
  }

  async set(position: Position): Promise<void> {
    this.position = { ...position };
  }

  async update(fill: Fill): Promise<Position> {
    const signedQty = match(fill.side)
      .with("buy", () => fill.qty)
      .with("sell", () => -fill.qty)
      .exhaustive();
    const nextQty = this.position.qty + signedQty;

    if (this.position.qty === 0 || Math.sign(this.position.qty) === Math.sign(signedQty)) {
      const previousNotional = this.position.avgEntry * Math.abs(this.position.qty);
      const nextNotional = fill.price * Math.abs(signedQty);
      const totalQty = Math.abs(this.position.qty) + Math.abs(signedQty);
      this.position.avgEntry = totalQty === 0 ? 0 : (previousNotional + nextNotional) / totalQty;
    } else if (nextQty === 0) {
      this.position.avgEntry = 0;
    } else if (Math.sign(nextQty) !== Math.sign(this.position.qty)) {
      this.position.avgEntry = fill.price;
    }

    this.position.qty = nextQty;
    this.position.unrealizedPnl = 0;
    return this.get();
  }
}
