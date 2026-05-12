import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { OrderSide, ExposureIntent } from "./QuoteLeg";
import type { MarketId } from "./MarketId";

export type PositionSide = "long" | "short" | "flat";

export type PositionSnapshot = Readonly<{
  market: MarketId;
  signedQuantity: number;
  averageEntryPrice: number | null;
  unrealizedPnl: number | null;
}>;

const FLAT_EPSILON = 1e-12;

export const PositionSnapshot = {
  create(input: PositionSnapshot): Result<PositionSnapshot, DomainError> {
    if (!Number.isFinite(input.signedQuantity)) {
      return err({
        type: "invalid_position",
        reason: `signedQuantity must be finite: ${input.signedQuantity}`,
      });
    }
    return ok(PositionSnapshot.unsafe(input));
  },

  unsafe(input: PositionSnapshot): PositionSnapshot {
    return Object.freeze({ ...input });
  },

  side(position: PositionSnapshot): PositionSide {
    if (Math.abs(position.signedQuantity) < FLAT_EPSILON) {
      return "flat";
    }
    return position.signedQuantity > 0 ? "long" : "short";
  },

  exposureIntentForOrderSide(position: PositionSnapshot, orderSide: OrderSide): ExposureIntent {
    const side = PositionSnapshot.side(position);
    if (side === "short" && orderSide === "buy") {
      return "reduce_exposure";
    }
    if (side === "long" && orderSide === "sell") {
      return "reduce_exposure";
    }
    return "increase_exposure";
  },

  maxReduceQuantity(position: PositionSnapshot): number {
    return Math.abs(position.signedQuantity);
  },
};
