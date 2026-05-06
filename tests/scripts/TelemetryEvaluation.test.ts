import { describe, expect, test } from "bun:test";

import { evaluateTelemetryRun } from "../../scripts/lib/TelemetryEvaluation.ts";
import type { TelemetryEvent } from "../../src/infrastructure/Telemetry.ts";

function event(
  type: TelemetryEvent["type"],
  timestamp: number,
  payload: TelemetryEvent["payload"],
): TelemetryEvent {
  return {
    id: `${type}-${timestamp}`,
    runId: "run-1",
    mode: "live",
    venue: "bulk",
    type,
    timestamp,
    market: "BTC-USD",
    payload,
  } as TelemetryEvent;
}

describe("evaluateTelemetryRun", () => {
  test("does not allow tuning when markout coverage is too low", () => {
    const result = evaluateTelemetryRun({
      fills: [
        {
          id: "fill-1",
          venue: "bulk",
          market: "BTC-USD",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.01,
          tradePnl: 0,
          filledAt: 1000,
        },
      ],
      events: [
        event("fill", 1000, {
          fillId: "fill-1",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.01,
          notional: 100,
          makerTaker: "maker",
        }),
      ],
      quotedCount: 2,
      minMarkoutCoverage: 0.8,
    });

    expect(result.dataHealth.markoutCoverage).toBe(0);
    expect(result.tuningAllowed).toBe(false);
    expect(result.issueSignals).toContain("low_markout_coverage");
  });

  test("computes markout, spread capture, adverse selection, and order quality", () => {
    const result = evaluateTelemetryRun({
      fills: [
        {
          id: "fill-1",
          venue: "bulk",
          market: "BTC-USD",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.01,
          tradePnl: 0.4,
          filledAt: 1000,
        },
        {
          id: "fill-2",
          venue: "bulk",
          market: "BTC-USD",
          side: "sell",
          price: 110,
          qty: 1,
          fee: 0.01,
          tradePnl: -0.2,
          filledAt: 2000,
        },
      ],
      events: [
        event("order", 900, {
          action: "submit",
          orderId: "order-1",
          side: "buy",
          price: 100,
          qty: 1,
          reduceOnly: false,
          timeInForce: "GTC",
          latencyMs: 25,
          status: "open",
          statusKey: "resting",
        }),
        event("order", 1900, {
          action: "reject",
          orderId: "order-2",
          side: "sell",
          price: 110,
          qty: 1,
          reduceOnly: false,
          timeInForce: "GTC",
          latencyMs: 50,
          status: "rejected",
          statusKey: "error",
          reason: "risk",
        }),
        event("markout", 1500, {
          fillId: "fill-1",
          basis: "mark",
          horizonSec: 5,
          markoutBps: 100,
          spreadCaptureBps: 50,
          adverse: false,
        }),
        event("markout", 2500, {
          fillId: "fill-2",
          basis: "mark",
          horizonSec: 5,
          markoutBps: -50,
          spreadCaptureBps: 20,
          adverse: true,
        }),
        event("runtime_health", 2600, {
          level: "warn",
          code: "ws_disconnect",
          message: "socket closed",
        }),
      ],
      quotedCount: 4,
      minMarkoutCoverage: 0.8,
    });

    expect(result.pnl.netPnl).toBeCloseTo(0.18);
    expect(result.markouts.avg5sBps).toBe(25);
    expect(result.markouts.adverseSelectionRate).toBe(0.5);
    expect(result.markouts.spreadCaptureBps).toBe(35);
    expect(result.orderQuality.fillRate).toBe(0.5);
    expect(result.orderQuality.rejectRate).toBe(0.5);
    expect(result.orderQuality.avgLatencyMs).toBe(37.5);
    expect(result.runtimeHealth.warningCount).toBe(1);
    expect(result.tuningAllowed).toBe(true);
  });

  test("signals a strategy model gap when usable telemetry is still unprofitable", () => {
    const result = evaluateTelemetryRun({
      fills: [
        {
          id: "fill-1",
          venue: "bulk",
          market: "BTC-USD",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.05,
          tradePnl: -0.01,
          filledAt: 1000,
        },
      ],
      events: [
        event("fill", 1000, {
          fillId: "fill-1",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.05,
          notional: 100,
          makerTaker: "maker",
        }),
        event("markout", 1500, {
          fillId: "fill-1",
          basis: "mark",
          horizonSec: 5,
          markoutBps: 10,
          spreadCaptureBps: 2,
          adverse: false,
        }),
      ],
      quotedCount: 10,
      minMarkoutCoverage: 0.8,
    });

    expect(result.tuningAllowed).toBe(true);
    expect(result.pnl.netPnl).toBeLessThan(0);
    expect(result.issueSignals).toContain("strategy_model_gap");
  });

  test("signals a strategy model gap when usable telemetry only breaks even", () => {
    const result = evaluateTelemetryRun({
      fills: [
        {
          id: "fill-1",
          venue: "bulk",
          market: "BTC-USD",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.05,
          tradePnl: 0.05,
          filledAt: 1000,
        },
      ],
      events: [
        event("fill", 1000, {
          fillId: "fill-1",
          side: "buy",
          price: 100,
          qty: 1,
          fee: 0.05,
          notional: 100,
          makerTaker: "maker",
        }),
        event("markout", 1500, {
          fillId: "fill-1",
          basis: "mark",
          horizonSec: 5,
          markoutBps: 10,
          spreadCaptureBps: 2,
          adverse: false,
        }),
      ],
      quotedCount: 10,
      minMarkoutCoverage: 0.8,
    });

    expect(result.tuningAllowed).toBe(true);
    expect(result.pnl.netPnl).toBe(0);
    expect(result.pnl.pnlPerNotional).toBe(0);
    expect(result.issueSignals).toContain("strategy_model_gap");
  });
});
