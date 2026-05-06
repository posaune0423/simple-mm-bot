import type { AppMode } from "../config.ts";
import type { OrderSide, OrderTimeInForce } from "../domain/entities/Quote.ts";

export type CapitalMode = "beta_mock" | "paper" | "backtest" | "real";

export interface TelemetryRun {
  id: string;
  mode: AppMode;
  venue: string;
  capitalMode: CapitalMode;
  market: string;
  configJson: unknown;
  gitSha?: string;
  gitDirty: boolean;
  startedAt: number;
  endedAt?: number;
  status: "running" | "completed" | "failed";
}

export interface MarketSnapshotTelemetry {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  microPrice: number;
  markPrice: number;
  spreadBps: number;
  topDepth?: { bid: number; ask: number };
  imbalance?: number;
  volatility?: number;
  stalenessMs: number;
}

export interface QuoteTelemetry {
  positionQty: number;
  fairPrice: number;
  sigma: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidDistanceBps: number;
  askDistanceBps: number;
  expectedSpreadBps: number;
  timeInForce: OrderTimeInForce;
}

export interface OrderTelemetry {
  action: "submit" | "ack" | "cancel" | "reject" | "fill";
  orderId?: string;
  side?: OrderSide;
  price?: number;
  qty?: number;
  reduceOnly?: boolean;
  timeInForce?: OrderTimeInForce;
  latencyMs?: number;
  status?: string;
  statusKey?: string;
  reason?: string;
  rawSummary?: unknown;
}

export interface FillTelemetry {
  fillId: string;
  orderId?: string;
  side: OrderSide;
  price: number;
  qty: number;
  fee: number;
  notional: number;
  makerTaker?: "maker" | "taker" | "unknown";
  filledAt?: number;
  rawSummary?: unknown;
}

export interface MarkoutTelemetry {
  fillId: string;
  basis: "mid" | "mark";
  horizonSec: 5 | 30 | 60 | 300;
  markoutBps: number;
  spreadCaptureBps: number;
  adverse: boolean;
}

export interface AccountRiskTelemetry {
  balance?: number;
  equity?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  positionQty?: number;
  marginRatio?: number | null;
  leverage?: number;
  drawdown?: number;
  reduceResult?: string;
  closeResult?: string;
}

export interface RuntimeHealthTelemetry {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
  rawSummary?: unknown;
}

export type TelemetryEvent =
  | BaseTelemetryEvent<"market_snapshot", MarketSnapshotTelemetry>
  | BaseTelemetryEvent<"quote", QuoteTelemetry>
  | BaseTelemetryEvent<"order", OrderTelemetry>
  | BaseTelemetryEvent<"fill", FillTelemetry>
  | BaseTelemetryEvent<"markout", MarkoutTelemetry>
  | BaseTelemetryEvent<"account_risk", AccountRiskTelemetry>
  | BaseTelemetryEvent<"runtime_health", RuntimeHealthTelemetry>;

export interface BaseTelemetryEvent<Type extends string, Payload> {
  id: string;
  runId: string;
  mode: AppMode;
  venue: string;
  type: Type;
  timestamp: number;
  market?: string;
  payload: Payload;
}
