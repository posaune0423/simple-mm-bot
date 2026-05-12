interface CandleLike {
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

export interface MarketSnapshot extends CandleLike {
  market: string;
  bestBid: number;
  bestAsk: number;
  microPrice: number;
  vampPrice?: number;
  orderBookLevels?: ReadonlyArray<OrderBookLevel>;
  markPrice: number;
  timestamp: number;
  bookUpdatedAt?: number;
  tickerUpdatedAt?: number;
  bookReceivedAt?: number;
  tickerReceivedAt?: number;
  bookExchangeTimestamp?: number;
  tickerExchangeTimestamp?: number;
  candleUpdatedAt?: number | null;
  accountUpdatedAt?: number | null;
  positionUpdatedAt?: number | null;
  positionQty?: number | null;
  unrealizedPnl?: number | null;
  volume?: number;
  marginRatio: number | null;
  availableMarginUsd?: number | null;
}

export interface OrderBookLevel {
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
}

export type SnapshotListener = (snapshot: MarketSnapshot) => void | Promise<void>;

export interface IMarketFeed {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSnapshot(): Promise<MarketSnapshot>;
  subscribe(listener: SnapshotListener): () => void;
  advance?(): Promise<boolean>;
}
