import type { TelemetryEvent, TelemetryRun } from "./Telemetry.ts";

export interface TelemetryEventQuery {
  runId?: string;
  types?: TelemetryEvent["type"][];
  from?: number;
  to?: number;
}

export interface ITelemetryRepository {
  startRun(run: TelemetryRun): Promise<void>;
  finishRun(runId: string, endedAt: number, status: TelemetryRun["status"]): Promise<void>;
  recordEvent(event: TelemetryEvent): Promise<void>;
  findRun(runId: string): Promise<TelemetryRun | null>;
  findEvents(query: TelemetryEventQuery): Promise<TelemetryEvent[]>;
}
