import type { Fill } from "../entities/Fill.ts";

export interface ITradeRepository {
  save(fill: Fill): Promise<void>;
  findByRange(from: number, to: number): Promise<Fill[]>;
  findAll(): Promise<Fill[]>;
}
