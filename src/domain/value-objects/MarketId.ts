import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { Brand } from "./Brand";

export type MarketId = Brand<string, "MarketId">;

export const MarketId = {
  create(value: string): Result<MarketId, DomainError> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return err({
        type: "invalid_market_id",
        value,
        reason: "market id must be non-empty",
      });
    }
    return ok(trimmed as MarketId);
  },

  unsafe(value: string): MarketId {
    return value as MarketId;
  },
};
