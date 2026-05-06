import type {
  AccountStateObservationFact,
  OrderbookSnapshotFact,
  SubmittedOrderFact,
  TradeFillFact,
  TradingRunFact,
} from "./Metrics.ts";

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
  findRun(runId: string): Promise<TradingRunFact | null>;
}
