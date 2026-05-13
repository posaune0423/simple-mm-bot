import type { OrderSide, OrderTimeInForce } from "../types/Order.ts";

type TradingRunMode = "live" | "paper" | "backtest";
export type CapitalMode = "beta_mock" | "paper" | "backtest" | "real";
type RunStatus = "running" | "completed" | "failed";
type OrderIntent = "quote" | "reduce" | "close";
type OrderType = "limit" | "market";
type OrderFinalStatus = "submitted" | "accepted" | "rejected" | "canceled" | "filled";
type MakerTaker = "maker" | "taker" | "unknown";
type RuntimeHealthLevel = "info" | "warn" | "error";
type QuoteDecisionIntent = "quote" | "reduce" | "disabled";
type OrderLifecycleAction = "submit" | "ack" | "cancel" | "reject" | "fill";

export interface TradingRunFact {
  id: string;
  mode: TradingRunMode;
  venue: string;
  market: string;
  capitalMode: CapitalMode;
  strategyName: string;
  configJson: unknown;
  gitSha?: string;
  gitDirty: boolean;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  stopReason?: string;
}

export interface OrderbookSnapshotFact {
  id: string;
  runId: string;
  venue: string;
  market: string;
  observedAt: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  microPrice: number;
  vampPrice?: number;
  markPrice: number;
  spreadBps: number;
  stalenessMs: number;
  rawJson?: unknown;
}

export interface SubmittedOrderFact {
  id: string;
  runId: string;
  venue: string;
  market: string;
  clientOrderId: string;
  venueOrderId?: string;
  intent: OrderIntent;
  side: OrderSide;
  orderType: OrderType;
  limitPrice?: number;
  quantity: number;
  timeInForce: OrderTimeInForce;
  submittedAt: number;
  acceptedAt?: number;
  rejectedAt?: number;
  canceledAt?: number;
  finalStatus: OrderFinalStatus;
  rejectReason?: string;
  latencyMs?: number;
  rawJson?: unknown;
}

export interface TradeFillFact {
  id: string;
  runId: string;
  submittedOrderId?: string;
  venue: string;
  market: string;
  venueFillId: string;
  venueOrderId?: string;
  side: OrderSide;
  price: number;
  quantity: number;
  fee: number;
  tradePnl: number;
  makerTaker: MakerTaker;
  filledAt: number;
  rawJson?: unknown;
}

export interface AccountStateObservationFact {
  id: string;
  runId: string;
  venue: string;
  market: string;
  observedAt: number;
  balance?: number;
  equity?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  positionQty?: number;
  marginRatio?: number | null;
  rawJson?: unknown;
}

export interface RuntimeHealthEventFact {
  id: string;
  runId: string;
  venue: string;
  market: string;
  observedAt: number;
  level: RuntimeHealthLevel;
  code: string;
  message: string;
  rawJson?: unknown;
}

export interface QuoteDecisionFact {
  id: string;
  runId: string;
  venue: string;
  market: string;
  quoteCycleId: string;
  side: OrderSide;
  level: number;
  intent: QuoteDecisionIntent;
  price: number;
  quantity: number;
  fairPrice: number;
  sigma: number;
  policy: OrderTimeInForce;
  positionQty: number;
  midPrice: number;
  microPrice: number;
  markPrice: number;
  spreadBps: number;
  stalenessMs: number;
  controlReasons: string[];
  createdAt: number;
  rawJson?: unknown;
}

export interface OrderLifecycleEventFact {
  id: string;
  runId: string;
  venue: string;
  market: string;
  action: OrderLifecycleAction;
  clientOrderId?: string;
  venueOrderId?: string;
  side?: OrderSide;
  intent?: OrderIntent;
  orderType?: OrderType;
  price?: number;
  quantity?: number;
  timeInForce?: OrderTimeInForce;
  status?: string;
  latencyMs?: number;
  observedAt: number;
  rawJson?: unknown;
}

export interface IMetricsRepository {
  startRun(run: TradingRunFact): Promise<void>;
  finishRun(
    runId: string,
    endedAt: number,
    status: TradingRunFact["status"],
    stopReason?: string,
  ): Promise<void>;
  recordOrderbookSnapshot(snapshot: OrderbookSnapshotFact): Promise<void>;
  recordSubmittedOrder(order: SubmittedOrderFact): Promise<void>;
  recordTradeFill(fill: TradeFillFact): Promise<void>;
  recordAccountStateObservation(observation: AccountStateObservationFact): Promise<void>;
  recordRuntimeHealthEvent(event: RuntimeHealthEventFact): Promise<void>;
  recordQuoteDecision(decision: QuoteDecisionFact): Promise<void>;
  recordOrderLifecycleEvent(event: OrderLifecycleEventFact): Promise<void>;
  findRun(runId: string): Promise<TradingRunFact | null>;
}
