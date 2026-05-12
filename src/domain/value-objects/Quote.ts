import { err, ok, type Result } from "neverthrow";
import type { DomainError } from "../errors/DomainError";
import type { MarketId } from "./MarketId";
import type { Price } from "./Price";
import type { QuoteLeg } from "./QuoteLeg";

export type QuoteDiagnostics = Readonly<{
  quoteModel: string;
  reasonTags: readonly string[];
}>;

export type Quote = Readonly<{
  market: MarketId;
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
      return err({
        type: "invalid_quote",
        reason: "quote must contain at least one bid or ask leg",
      });
    }
    if (!Number.isFinite(input.sigma) || input.sigma < 0) {
      return err({
        type: "invalid_quote",
        reason: `sigma must be finite and non-negative: ${input.sigma}`,
      });
    }
    if (!isSortedByLevel(input.bids) || !isSortedByLevel(input.asks)) {
      return err({
        type: "invalid_quote",
        reason: "quote legs must be sorted by contiguous level",
      });
    }

    const bestBid = input.bids[0];
    const bestAsk = input.asks[0];
    if (bestBid !== undefined && bestAsk !== undefined && bestBid.price >= bestAsk.price) {
      return err({
        type: "invalid_quote",
        reason: `crossed quote: bid=${bestBid.price}, ask=${bestAsk.price}`,
      });
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
