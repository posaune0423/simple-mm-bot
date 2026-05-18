import { err } from "neverthrow";

import {
  createTopOfBookUpdate,
  ExternalNormalizationError,
  type ExternalNormalizationResult,
} from "../normalization.ts";

type BybitOrderbookPayload = {
  topic?: unknown;
  ts?: unknown;
  data?: {
    s?: unknown;
    b?: unknown[][];
    a?: unknown[][];
    u?: unknown;
    seq?: unknown;
    cts?: unknown;
  };
};

export function normalizeBybitOrderbook1(
  payload: BybitOrderbookPayload,
): ExternalNormalizationResult {
  const symbol =
    typeof payload.data?.s === "string" ? payload.data.s : symbolFromTopic(payload.topic);
  const bid = payload.data?.b?.[0];
  const ask = payload.data?.a?.[0];
  if (symbol === undefined) {
    return err(new ExternalNormalizationError("missing_symbol", { venue: "bybit_linear" }));
  }
  if (bid === undefined || ask === undefined) {
    return err(new ExternalNormalizationError("missing_book", { venue: "bybit_linear", symbol }));
  }
  return createTopOfBookUpdate({
    venue: "bybit_linear",
    symbol,
    bidPrice: bid[0],
    bidSize: bid[1],
    askPrice: ask[0],
    askSize: ask[1],
    exchangeTime: payload.data?.cts ?? payload.ts,
    sequence: payload.data?.seq ?? payload.data?.u,
    raw: payload,
  });
}

function symbolFromTopic(topic: unknown): string | undefined {
  if (typeof topic !== "string") {
    return undefined;
  }
  return topic.split(".").at(-1);
}
