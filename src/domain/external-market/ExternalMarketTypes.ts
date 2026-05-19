export type ExternalVenueId = "binance_usdm" | "okx_swap" | "bybit_linear";

export type ExternalMarketSourceConfig = Readonly<{
  venue: ExternalVenueId;
  symbol: string;
  weight: number;
}>;

export type ExternalTopOfBook = Readonly<{
  venue: ExternalVenueId;
  symbol: string;
  exchangeTime?: number;
  receivedAt: number;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  midPrice: number;
  microPrice?: number;
  spreadBps: number;
  sequence?: string;
  raw?: unknown;
}>;

export type ExternalMarketTopOfBookRecord = ExternalTopOfBook &
  Readonly<{
    id: string;
  }>;

export type ExternalMarketTickerRecord = Readonly<{
  id: string;
  venue: ExternalVenueId;
  symbol: string;
  exchangeTime?: number;
  receivedAt: number;
  markPrice?: number;
  indexPrice?: number;
  lastPrice?: number;
  fundingRate?: number;
  openInterest?: number;
  raw?: unknown;
}>;

export type ExternalMarketTradeRecord = Readonly<{
  id: string;
  venue: ExternalVenueId;
  symbol: string;
  tradeId?: string;
  exchangeTime?: number;
  receivedAt: number;
  price: number;
  quantity: number;
  side?: "buy" | "sell" | "unknown";
  aggressorSide?: "buy" | "sell" | "unknown";
  raw?: unknown;
}>;

export type ExternalTopOfBookUpdate = Readonly<{
  venue: ExternalVenueId;
  symbol: string;
  exchangeTime?: number;
  receivedAt: number;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  sequence?: string;
  raw?: unknown;
}>;

export function externalMarketSourceKey(
  source: Pick<ExternalMarketSourceConfig, "venue" | "symbol">,
): string {
  return `${source.venue}:${source.symbol}`;
}
