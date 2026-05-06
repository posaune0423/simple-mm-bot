import { describe, expect, test } from "bun:test";

import { evaluateMetricsRun } from "../../scripts/lib/MetricsEvaluation.ts";

describe("evaluateMetricsRun", () => {
  test("does not allow tuning when markout coverage is too low", () => {
    const result = evaluateMetricsRun({
      fillCount: 1,
      markoutCoverage: 0,
      netPnl: 0,
      tradePnl: 0,
      fee: 0.01,
      pnlPerNotional: 0,
      maxDrawdown: 0,
      avg5sMarkoutBps: 0,
      adverseSelectionRate: 0,
      fillRate: 0.5,
      rejectRate: 0,
      cancelRate: 0,
      minMarkoutCoverage: 0.8,
    });

    expect(result.dataHealth.markoutCoverage).toBe(0);
    expect(result.tuningAllowed).toBe(false);
    expect(result.issueSignals).toContain("low_markout_coverage");
  });

  test("maps metrics view values into tuning inputs", () => {
    const result = evaluateMetricsRun({
      fillCount: 2,
      markoutCoverage: 1,
      snapshotFreshnessMs: 42,
      netPnl: 0.18,
      tradePnl: 0.2,
      fee: 0.02,
      pnlPerNotional: 0.0009,
      maxDrawdown: 0.2,
      avg5sMarkoutBps: 25,
      adverseSelectionRate: 0.5,
      spreadCaptureBps: 35,
      fillRate: 0.5,
      rejectRate: 0.5,
      cancelRate: 0.25,
      makerRatio: 0.75,
      avgLatencyMs: 37.5,
      positionSkew: 0.1,
      closeCost: 0.02,
      warningCount: 1,
      errorCount: 0,
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

  test("signals a strategy model gap when usable metrics are unprofitable", () => {
    const result = evaluateMetricsRun({
      fillCount: 1,
      markoutCoverage: 1,
      netPnl: 0,
      tradePnl: 0.05,
      fee: 0.05,
      pnlPerNotional: 0,
      maxDrawdown: 0,
      avg5sMarkoutBps: 10,
      adverseSelectionRate: 0,
      fillRate: 0.1,
      rejectRate: 0,
      cancelRate: 0,
      minMarkoutCoverage: 0.8,
    });

    expect(result.tuningAllowed).toBe(true);
    expect(result.pnl.netPnl).toBe(0);
    expect(result.pnl.pnlPerNotional).toBe(0);
    expect(result.issueSignals).toContain("strategy_model_gap");
  });
});
