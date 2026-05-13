import type { Fill } from "../types/Fill.ts";
import type { Position } from "../types/Position.ts";

export interface IPositionRepository {
  get(): Promise<Position>;
  update(fill: Fill): Promise<Position>;
  set(position: Position): Promise<void>;
}
