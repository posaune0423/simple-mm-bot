import { err } from "neverthrow";

import {
  createTopOfBookUpdate,
  ExternalNormalizationError,
  type ExternalNormalizationResult,
} from "../normalization.ts";

type OkxBboPayload = {
  arg?: { instId?: unknown };
  data?: Array<{
    asks?: unknown[][];
    bids?: unknown[][];
    ts?: unknown;
    seqId?: unknown;
  }>;
};

export function normalizeOkxBbo(payload: OkxBboPayload): ExternalNormalizationResult {
  const symbol = typeof payload.arg?.instId === "string" ? payload.arg.instId : undefined;
  const book = payload.data?.[0];
  const bid = book?.bids?.[0];
  const ask = book?.asks?.[0];
  if (symbol === undefined) {
    return err(new ExternalNormalizationError("missing_symbol", { venue: "okx_swap" }));
  }
  if (book === undefined || bid === undefined || ask === undefined) {
    return err(new ExternalNormalizationError("missing_book", { venue: "okx_swap", symbol }));
  }
  return createTopOfBookUpdate({
    venue: "okx_swap",
    symbol,
    bidPrice: bid[0],
    bidSize: bid[1],
    askPrice: ask[0],
    askSize: ask[1],
    exchangeTime: book.ts,
    sequence: book.seqId,
    raw: payload,
  });
}
