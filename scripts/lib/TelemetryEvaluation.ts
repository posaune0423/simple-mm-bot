import type { Fill } from "../../src/domain/entities/Fill.ts";
import type { TelemetryEvent } from "../../src/infrastructure/Telemetry.ts";

export interface EvaluationInput {
  fills: Fill[];
  events: TelemetryEvent[];
  quotedCount: number;
  minMarkoutCoverage?: number;
}

export interface TelemetryEvaluation {
  dataHealth: {
    fillCount: number;
    markoutCoverage: number;
    rawFieldCoverage: number;
    snapshotFreshnessMs: number | null;
  };
  pnl: {
    netPnl: number;
    tradePnl: number;
    fee: number;
    pnlPerNotional: number;
    maxDrawdown: number;
  };
  markouts: {
    avg5sBps: number;
    adverseSelectionRate: number;
    spreadCaptureBps: number;
  };
  orderQuality: {
    fillRate: number;
    rejectRate: number;
    cancelRate: number;
    makerRatio: number;
    avgLatencyMs: number;
  };
  inventory: {
    positionSkew: number;
    closeCost: number;
  };
  runtimeHealth: {
    warningCount: number;
    errorCount: number;
  };
  tuningAllowed: boolean;
  issueSignals: string[];
}

export function evaluateTelemetryRun(input: EvaluationInput): TelemetryEvaluation {
  const minMarkoutCoverage = input.minMarkoutCoverage ?? 0.8;
  const markoutEvents = markouts(input.events, 5);
  const orderEvents = input.events.filter((event) => event.type === "order");
  const fillEvents = input.events.filter((event) => event.type === "fill");
  const runtimeEvents = input.events.filter((event) => event.type === "runtime_health");
  const marketEvents = input.events.filter((event) => event.type === "market_snapshot");
  const fillCount = input.fills.length;
  const markoutCoverage = fillCount > 0 ? uniqueFillIds(markoutEvents).size / fillCount : 1;
  const notional = input.fills.reduce((sum, fill) => sum + fill.price * fill.qty, 0);
  const tradePnl = input.fills.reduce((sum, fill) => sum + fill.tradePnl, 0);
  const fee = input.fills.reduce((sum, fill) => sum + fill.fee, 0);
  const netPnl = tradePnl - fee;
  const pnlPerNotional = notional > 0 ? netPnl / notional : 0;
  const issueSignals = issueSignalsFor({
    markoutCoverage,
    minMarkoutCoverage,
    orderEvents,
    runtimeEvents,
    fillCount,
    netPnl,
    pnlPerNotional,
  });

  return {
    dataHealth: {
      fillCount,
      markoutCoverage,
      rawFieldCoverage: rawFieldCoverage(input.events),
      snapshotFreshnessMs: latestSnapshotFreshness(marketEvents),
    },
    pnl: {
      netPnl,
      tradePnl,
      fee,
      pnlPerNotional,
      maxDrawdown: maxDrawdown(input.fills),
    },
    markouts: {
      avg5sBps: average(markoutEvents.map((event) => event.payload.markoutBps)),
      adverseSelectionRate:
        markoutEvents.length > 0
          ? markoutEvents.filter((event) => event.payload.adverse).length / markoutEvents.length
          : 0,
      spreadCaptureBps: average(markoutEvents.map((event) => event.payload.spreadCaptureBps)),
    },
    orderQuality: {
      fillRate: input.quotedCount > 0 ? fillCount / input.quotedCount : 0,
      rejectRate: ratio(orderEvents, (event) => event.payload.action === "reject"),
      cancelRate: ratio(orderEvents, (event) => event.payload.action === "cancel"),
      makerRatio:
        fillEvents.length > 0
          ? fillEvents.filter((event) => event.payload.makerTaker === "maker").length /
            fillEvents.length
          : 0,
      avgLatencyMs: average(
        orderEvents
          .map((event) => event.payload.latencyMs)
          .filter((latency): latency is number => latency !== undefined),
      ),
    },
    inventory: {
      positionSkew: latestPositionSkew(input.events),
      closeCost: closeCost(input.events),
    },
    runtimeHealth: {
      warningCount: runtimeEvents.filter((event) => event.payload.level === "warn").length,
      errorCount: runtimeEvents.filter((event) => event.payload.level === "error").length,
    },
    tuningAllowed: markoutCoverage >= minMarkoutCoverage && fillCount > 0,
    issueSignals,
  };
}

function markouts(events: TelemetryEvent[], horizonSec: 5) {
  return events.filter(
    (event): event is Extract<TelemetryEvent, { type: "markout" }> =>
      event.type === "markout" && event.payload.horizonSec === horizonSec,
  );
}

function uniqueFillIds(events: Array<Extract<TelemetryEvent, { type: "markout" }>>): Set<string> {
  return new Set(events.map((event) => event.payload.fillId));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(
  events: Array<Extract<TelemetryEvent, { type: "order" }>>,
  predicate: (event: Extract<TelemetryEvent, { type: "order" }>) => boolean,
): number {
  if (events.length === 0) {
    return 0;
  }
  return events.filter(predicate).length / events.length;
}

function rawFieldCoverage(events: TelemetryEvent[]): number {
  const rawCapable = events.filter((event) => event.type === "order" || event.type === "fill");
  if (rawCapable.length === 0) {
    return 1;
  }
  return (
    rawCapable.filter(
      (event) =>
        (event.type === "order" && event.payload.rawSummary !== undefined) ||
        (event.type === "fill" && event.payload.rawSummary !== undefined),
    ).length / rawCapable.length
  );
}

function latestSnapshotFreshness(
  events: Array<Extract<TelemetryEvent, { type: "market_snapshot" }>>,
): number | null {
  if (events.length === 0) {
    return null;
  }
  return events.reduce((latest, event) => (event.timestamp > latest.timestamp ? event : latest))
    .payload.stalenessMs;
}

function maxDrawdown(fills: Fill[]): number {
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const fill of fills) {
    cumulative += fill.tradePnl - fill.fee;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return drawdown;
}

function latestPositionSkew(events: TelemetryEvent[]): number {
  const riskEvents = events.filter(
    (event): event is Extract<TelemetryEvent, { type: "account_risk" }> =>
      event.type === "account_risk",
  );
  const latest = riskEvents.at(-1);
  return latest?.payload.positionQty ?? 0;
}

function closeCost(events: TelemetryEvent[]): number {
  return events
    .filter(
      (event): event is Extract<TelemetryEvent, { type: "fill" }> =>
        event.type === "fill" && event.payload.orderId?.startsWith("close-") === true,
    )
    .reduce((sum, event) => sum + event.payload.fee, 0);
}

function issueSignalsFor(input: {
  markoutCoverage: number;
  minMarkoutCoverage: number;
  orderEvents: Array<Extract<TelemetryEvent, { type: "order" }>>;
  runtimeEvents: Array<Extract<TelemetryEvent, { type: "runtime_health" }>>;
  fillCount: number;
  netPnl: number;
  pnlPerNotional: number;
}): string[] {
  const signals: string[] = [];
  if (input.markoutCoverage < input.minMarkoutCoverage) {
    signals.push("low_markout_coverage");
  }
  if (input.orderEvents.some((event) => event.payload.reason === "missing_sdk_fields")) {
    signals.push("missing_sdk_fields");
  }
  if (input.runtimeEvents.some((event) => event.payload.code === "stale_feed")) {
    signals.push("stale_feed");
  }
  if (input.orderEvents.some((event) => event.payload.action === "reject")) {
    signals.push("order_lifecycle_inconsistency");
  }
  if (
    input.fillCount > 0 &&
    input.markoutCoverage >= input.minMarkoutCoverage &&
    (input.netPnl <= 0 || input.pnlPerNotional <= 0)
  ) {
    signals.push("strategy_model_gap");
  }
  return signals;
}
