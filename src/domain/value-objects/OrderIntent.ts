import { err, ok, type Result } from "neverthrow";
import { InvalidOrderIntentError, type DomainError } from "../errors/DomainError";
import type { OrderTimeInForce } from "../types/Order";
import type { Price } from "./Price";
import type { Quantity } from "./Quantity";
import type { ExposureIntent, OrderSide, QuoteSide } from "./QuoteLeg";

export type OrderIntent = Readonly<{
  key: string;
  market: string;
  orderSide: OrderSide;
  price: Price;
  quantity: Quantity;
  timeInForce: OrderTimeInForce;
  postOnly: boolean;
  reduceOnly: boolean;
  exposureIntent: ExposureIntent;
  sourceQuoteSide: QuoteSide;
  sourceQuoteLevel: number;
  reasonTags: readonly string[];
  clientOrderId: string;
}>;

export const OrderIntent = {
  create(input: OrderIntent): Result<OrderIntent, DomainError> {
    const key = input.key.trim();
    const clientOrderId = input.clientOrderId.trim();
    if (key.length === 0) {
      return err(new InvalidOrderIntentError("order intent key must be non-empty"));
    }
    if (clientOrderId.length === 0) {
      return err(new InvalidOrderIntentError("clientOrderId must be non-empty"));
    }
    if (!Number.isInteger(input.sourceQuoteLevel) || input.sourceQuoteLevel < 0) {
      return err(
        new InvalidOrderIntentError(
          `sourceQuoteLevel must be a non-negative integer: ${input.sourceQuoteLevel}`,
          { context: { sourceQuoteLevel: input.sourceQuoteLevel } },
        ),
      );
    }
    if (input.exposureIntent === "reduce_exposure" && !input.reduceOnly) {
      return err(new InvalidOrderIntentError("reduce_exposure order intent must be reduceOnly"));
    }
    if (input.exposureIntent === "increase_exposure" && input.reduceOnly) {
      return err(
        new InvalidOrderIntentError("increase_exposure order intent must not be reduceOnly"),
      );
    }

    return ok(
      Object.freeze({
        ...input,
        key,
        clientOrderId,
        reasonTags: Object.freeze([...input.reasonTags]),
      }),
    );
  },
};
