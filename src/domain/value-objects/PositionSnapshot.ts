import { err, ok, type Result } from "neverthrow";
import { match } from "ts-pattern";
import { InvalidPositionError, type DomainError } from "../errors/DomainError";
import type { OrderSide, ExposureIntent } from "./QuoteLeg";

type PositionSide = "long" | "short" | "flat";

export type PositionSnapshot = Readonly<{
  market: string;
  signedQuantity: number;
  averageEntryPrice: number | null;
  unrealizedPnl: number | null;
}>;

const FLAT_EPSILON = 1e-12;

export const PositionSnapshot = {
  create(input: PositionSnapshot): Result<PositionSnapshot, DomainError> {
    if (!Number.isFinite(input.signedQuantity)) {
      return err(
        new InvalidPositionError(`signedQuantity must be finite: ${input.signedQuantity}`, {
          context: { signedQuantity: input.signedQuantity },
        }),
      );
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
    return match<[PositionSide, OrderSide], ExposureIntent>([side, orderSide])
      .with(["short", "buy"], () => "reduce_exposure")
      .with(["long", "sell"], () => "reduce_exposure")
      .otherwise(() => "increase_exposure");
  },

  maxReduceQuantity(position: PositionSnapshot): number {
    const quantity = Math.abs(position.signedQuantity);
    return quantity < FLAT_EPSILON ? 0 : quantity;
  },
};
