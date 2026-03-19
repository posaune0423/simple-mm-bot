export interface BookLevel {
  price: number;
  size: number;
}

export interface BookSnapshot {
  coin: string;
  time: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface ClearinghouseState {
  accountValue: number;
  totalMarginUsed: number;
}

export interface AssetInfo {
  name: string;
}

export interface OpenOrder {
  coin: string;
  oid: number;
}

export interface UserFill {
  hash: string;
  coin: string;
  side: string;
  price: number;
  size: number;
  fee: number;
  closedPnl: number;
  time: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

export const SUPPORTED_INTERVALS: readonly CandleInterval[] = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
];

export interface PlaceOrderParams {
  asset: number;
  isBuy: boolean;
  price: string;
  size: string;
  reduceOnly: boolean;
  timeInForce: "Alo" | "Gtc" | "Ioc";
}

export interface CancelOrderParams {
  asset: number;
  oid: number;
}

export type Unsubscribe = () => Promise<void>;
