import { err } from "neverthrow";

import {
  createTopOfBookUpdate,
  ExternalNormalizationError,
  type ExternalNormalizationResult,
} from "../normalization.ts";

type BinanceBookTickerPayload = {
  s?: unknown;
  b?: unknown;
  B?: unknown;
  a?: unknown;
  A?: unknown;
  E?: unknown;
  T?: unknown;
  u?: unknown;
};

export function normalizeBinanceUsdmBookTicker(
  payload: BinanceBookTickerPayload,
): ExternalNormalizationResult {
  const symbol = typeof payload.s === "string" ? payload.s : undefined;
  if (symbol === undefined) {
    return err(new ExternalNormalizationError("missing_symbol", { venue: "binance_usdm" }));
  }
  return createTopOfBookUpdate({
    venue: "binance_usdm",
    symbol,
    bidPrice: payload.b,
    bidSize: payload.B,
    askPrice: payload.a,
    askSize: payload.A,
    exchangeTime: payload.T ?? payload.E,
    sequence: payload.u,
    raw: payload,
  });
}
