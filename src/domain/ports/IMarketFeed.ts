export interface CandleLike {
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
  markPrice: number;
  timestamp: number;
  volume?: number;
  marginRatio: number | null;
}

export type SnapshotListener = (snapshot: MarketSnapshot) => void | Promise<void>;

export interface IMarketFeed {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSnapshot(): Promise<MarketSnapshot>;
  subscribe(listener: SnapshotListener): () => void;
}
