import { err, ok, type Result } from "neverthrow";
import { EmptyQuoteError, InvalidQuoteError, type DomainError } from "../errors/DomainError";
import type { FairValueSnapshot } from "../external-market/FairValueTypes";
import type { Price } from "./Price";
import type { QuoteLeg } from "./QuoteLeg";

type QuoteDiagnostics = Readonly<{
  quoteModel: string;
  reasonTags: readonly string[];
  alphaDriftBps?: number;
  fundingRateBps?: number;
  expectedFundingBps?: number;
  basisBps?: number;
  targetInventoryQty?: number;
  inventoryErrorQty?: number;
  fairPriceSource?: "local" | "external" | "blended" | "local_fallback";
  localFairPrice?: number;
  externalFair?: FairValueSnapshot;
}>;

export type Quote = Readonly<{
  market: string;
  bids: readonly QuoteLeg[];
  asks: readonly QuoteLeg[];
  referencePrice: Price;
  fairPrice: Price;
  reservationPrice?: Price;
  sigma: number;
  diagnostics: QuoteDiagnostics;
}>;

export const Quote = {
  create(input: Quote): Result<Quote, DomainError> {
    if (input.bids.length === 0 && input.asks.length === 0) {
      return err(new EmptyQuoteError());
    }
    if (!Number.isFinite(input.sigma) || input.sigma < 0) {
      return err(
        new InvalidQuoteError(`sigma must be finite and non-negative: ${input.sigma}`, {
          context: { sigma: input.sigma },
        }),
      );
    }
    if (!isSortedByLevel(input.bids) || !isSortedByLevel(input.asks)) {
      return err(new InvalidQuoteError("quote legs must be sorted by contiguous level"));
    }

    const bestBid = input.bids[0];
    const bestAsk = input.asks[0];
    if (bestBid !== undefined && bestAsk !== undefined && bestBid.price >= bestAsk.price) {
      return err(
        new InvalidQuoteError(`crossed quote: bid=${bestBid.price}, ask=${bestAsk.price}`, {
          context: { bid: bestBid.price, ask: bestAsk.price },
        }),
      );
    }

    return ok(
      Object.freeze({
        ...input,
        bids: Object.freeze([...input.bids]),
        asks: Object.freeze([...input.asks]),
        diagnostics: Object.freeze({
          ...input.diagnostics,
          reasonTags: Object.freeze([...input.diagnostics.reasonTags]),
        }),
      }),
    );
  },
};

function isSortedByLevel(legs: readonly QuoteLeg[]): boolean {
  return legs.every((leg, index) => leg.level === index);
}
