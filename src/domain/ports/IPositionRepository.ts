import type { Fill } from "../entities/Fill.ts";
import type { Position } from "../entities/Position.ts";

export interface IPositionRepository {
  get(): Promise<Position>;
  update(fill: Fill): Promise<Position>;
  set(position: Position): Promise<void>;
}
