import type {
  ExternalMarketTopOfBookRecord,
  ExternalTopOfBookUpdate,
  ExternalVenueId,
} from "../../domain/external-market/ExternalMarketTypes.ts";

export function topOfBookRecordFromUpdate(
  update: ExternalTopOfBookUpdate,
): ExternalMarketTopOfBookRecord {
  const midPrice = (update.bidPrice + update.askPrice) / 2;
  const microPrice =
    (update.bidPrice * update.askSize + update.askPrice * update.bidSize) /
    (update.bidSize + update.askSize);
  return {
    ...update,
    id: externalTopOfBookId(update),
    midPrice,
    microPrice,
    spreadBps: ((update.askPrice - update.bidPrice) / midPrice) * 10_000,
  };
}

export function createTopOfBookUpdate(params: {
  venue: ExternalVenueId;
  symbol: string;
  bidPrice: unknown;
  bidSize: unknown;
  askPrice: unknown;
  askSize: unknown;
  receivedAt?: number;
  exchangeTime?: unknown;
  sequence?: unknown;
  raw?: unknown;
}): ExternalTopOfBookUpdate | null {
  const bidPrice = parseFinitePositiveNumber(params.bidPrice);
  const bidSize = parseFinitePositiveNumber(params.bidSize);
  const askPrice = parseFinitePositiveNumber(params.askPrice);
  const askSize = parseFinitePositiveNumber(params.askSize);
  if (
    bidPrice === null ||
    bidSize === null ||
    askPrice === null ||
    askSize === null ||
    bidPrice >= askPrice
  ) {
    return null;
  }

  const exchangeTime = parseOptionalInteger(params.exchangeTime);
  return {
    venue: params.venue,
    symbol: params.symbol,
    exchangeTime,
    receivedAt: params.receivedAt ?? Date.now(),
    bidPrice,
    bidSize,
    askPrice,
    askSize,
    sequence: stringifySequence(params.sequence),
    raw: params.raw,
  };
}

function externalTopOfBookId(update: ExternalTopOfBookUpdate): string {
  return [
    update.venue,
    update.symbol,
    update.sequence ?? "no-seq",
    update.exchangeTime ?? "no-exchange-time",
    update.receivedAt,
  ].join(":");
}

function parseFinitePositiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function stringifySequence(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}
