export type RecorderVenue = "bulk" | "binance_usdm" | "okx_swap" | "bybit_linear";

export type BookLevel = {
  price: number;
  quantity: number;
};

export type MarketDataBookSnapshot = {
  id: string;
  venue: RecorderVenue;
  symbol: string;
  exchangeTime?: number;
  receivedAt: number;
  depth: number;
  bestBidPrice: number;
  bestBidSize: number;
  bestAskPrice: number;
  bestAskSize: number;
  midPrice: number;
  microPrice?: number;
  vampPrice?: number;
  spreadBps: number;
  bids: BookLevel[];
  asks: BookLevel[];
  sequence?: string;
  raw?: unknown;
};

export type MarketDataTrade = {
  id: string;
  venue: RecorderVenue;
  symbol: string;
  tradeId?: string;
  exchangeTime?: number;
  receivedAt: number;
  price: number;
  quantity: number;
  side?: "buy" | "sell" | "unknown";
  aggressorSide?: "buy" | "sell" | "unknown";
  raw?: unknown;
};

export type MarketDataTicker = {
  id: string;
  venue: RecorderVenue;
  symbol: string;
  exchangeTime?: number;
  receivedAt: number;
  markPrice?: number;
  indexPrice?: number;
  lastPrice?: number;
  fundingRate?: number;
  openInterest?: number;
  raw?: unknown;
};
