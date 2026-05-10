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
      fillCount: 3,
      markoutCoverage: 1,
      snapshotFreshnessMs: 42,
      netPnl: 0.18,
      tradePnl: 0.2,
      fee: 0.02,
      pnlPerNotional: 0.0009,
      maxDrawdown: 0.2,
      avg5sMarkoutBps: 25,
      avg30sMarkoutBps: 12,
      avg300sMarkoutBps: 3,
      vw5sMarkoutBps: 15,
      vw30sMarkoutBps: 9,
      vw300sMarkoutBps: 1,
      markout30sTailBps: { p10: -12, p5: -20, worst: -30 },
      adverseSelectionRate: 0.5,
      adverseSelectionRate30s: 0.25,
      adverseSelectionRate300s: 0.125,
      spreadCaptureBps: 35,
      realizedSpreadBps: 18,
      sideImbalance: 0.25,
      avgMarketSpreadBps: 7,
      staleRate: 0.1,
      fillRate: 0.5,
      rejectRate: 0.5,
      cancelRate: 0.25,
      cancelBeforeFillRate: 0.2,
      makerRatio: 0.75,
      avgLatencyMs: 37.5,
      avgOrderLiveMs: 850,
      avgQuoteDistanceToMidBps: 12,
      avgQuoteDistanceToBestBps: 8,
      positionSkew: 0.1,
      closeCost: 0.02,
      warningCount: 1,
      errorCount: 0,
      minMarkoutCoverage: 0.8,
    });

    expect(result.pnl.netPnl).toBeCloseTo(0.18);
    expect(result.pnl.pnlPerVolumeBps).toBe(9);
    expect(result.markouts.avg5sBps).toBe(25);
    expect(result.markouts.avg30sBps).toBe(12);
    expect(result.markouts.avg300sBps).toBe(3);
    expect(result.markouts.vw5sBps).toBe(15);
    expect(result.markouts.vw30sBps).toBe(9);
    expect(result.markouts.vw300sBps).toBe(1);
    expect(result.markouts.tail30sBps).toEqual({ p10: -12, p5: -20, worst: -30 });
    expect(result.markouts.adverseSelectionRate).toBe(0.5);
    expect(result.markouts.adverseSelectionRate5s).toBe(0.5);
    expect(result.markouts.adverseSelectionRate30s).toBe(0.25);
    expect(result.markouts.adverseSelectionRate300s).toBe(0.125);
    expect(result.markouts.spreadCaptureBps).toBe(35);
    expect(result.markouts.realizedSpreadBps).toBe(18);
    expect(result.orderQuality.sideImbalance).toBe(0.25);
    expect(result.orderQuality.fillRate).toBe(0.5);
    expect(result.orderQuality.rejectRate).toBe(0.5);
    expect(result.orderQuality.cancelBeforeFillRate).toBe(0.2);
    expect(result.orderQuality.makerRatio).toBe(0.75);
    expect(result.orderQuality.avgLatencyMs).toBe(37.5);
    expect(result.orderQuality.avgLiveMs).toBe(850);
    expect(result.market.avgSpreadBps).toBe(7);
    expect(result.market.avgQuoteDistanceToMidBps).toBe(12);
    expect(result.market.avgQuoteDistanceToBestBps).toBe(8);
    expect(result.market.staleRate).toBe(0.1);
    expect(result.runtimeHealth.warningCount).toBe(1);
    expect(result.verdict).toBe("pass");
    expect(result.parameterAction).toBe("hold");
    expect(result.tuningAllowed).toBe(true);
  });

  test("fails the A-S gate and recommends widening when markout tail is toxic", () => {
    const result = evaluateMetricsRun({
      fillCount: 8,
      markoutCoverage: 1,
      netPnl: 1,
      tradePnl: 1.2,
      fee: 0.2,
      pnlPerNotional: 0.0008,
      pnlPerVolumeBps: 8,
      maxDrawdown: 0.2,
      avg5sMarkoutBps: -4,
      avg30sMarkoutBps: -6,
      avg300sMarkoutBps: -8,
      markout30sTailBps: { p10: -180, p5: -220, worst: -300 },
      adverseSelectionRate: 0.75,
      fillRate: 0.2,
      rejectRate: 0,
      cancelRate: 0,
      sideImbalance: 0.2,
      minMarkoutCoverage: 0.8,
    });

    expect(result.verdict).toBe("review");
    expect(result.passFail).toEqual({
      netPnl: true,
      pnlPerVolumeBps: true,
      avgMarkout30s: false,
      markoutTail: false,
      sideImbalance: true,
      volumeRequiredPace: true,
      volumeBalancedPace: true,
      sizeIncreaseAllowed: false,
    });
    expect(result.parameterAction).toBe("widen_spread_or_increase_gamma");
  });

  test("does not allow tuning when fill count is too low", () => {
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

    expect(result.tuningAllowed).toBe(false);
    expect(result.issueSignals).toContain("low_fill_count");
  });

  test("signals a strategy model gap when usable metrics are unprofitable", () => {
    const result = evaluateMetricsRun({
      fillCount: 3,
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

  test("signals lifecycle and competitiveness gaps for no-fill quote churn", () => {
    const result = evaluateMetricsRun({
      fillCount: 0,
      markoutCoverage: 0,
      netPnl: 0,
      tradePnl: 0,
      fee: 0,
      pnlPerNotional: 0,
      maxDrawdown: 0,
      avg5sMarkoutBps: 0,
      adverseSelectionRate: 0,
      fillRate: 0,
      rejectRate: 0,
      cancelRate: 0.95,
      cancelBeforeFillRate: 0.95,
      avgOrderLiveMs: 700,
      avgMarketSpreadBps: 0.1,
      avgQuoteDistanceToBestBps: 28,
      minMarkoutCoverage: 0.8,
    });

    expect(result.issueSignals).toContain("high_cancel_churn");
    expect(result.issueSignals).toContain("short_order_lifetime");
    expect(result.issueSignals).toContain("quotes_far_from_touch");
  });

  test("flags runs below the required and balanced 14d volume pace", () => {
    const result = evaluateMetricsRun({
      fillCount: 30,
      markoutCoverage: 1,
      notionalUsd: 4_578_556.1,
      windowDays: 1,
      netPnl: -182.52,
      tradePnl: 0,
      fee: 182.52,
      pnlPerNotional: -0.0000398639,
      pnlPerVolumeBps: -0.398639,
      maxDrawdown: 0,
      avg5sMarkoutBps: 0.617051,
      adverseSelectionRate: 0.45904,
      fillRate: 0.5,
      rejectRate: 0,
      cancelRate: 0,
      minMarkoutCoverage: 0.8,
    });

    expect(result.volume.projected14dUsd).toBeCloseTo(64_099_785.4);
    expect(result.volume.required14dUsd).toBe(150_000_000);
    expect(result.volume.requiredMultiplier).toBeCloseTo(2.3401, 4);
    expect(result.volume.projectedShortfallUsd).toBeCloseTo(85_900_214.6);
    expect(result.passFail.volumeRequiredPace).toBe(false);
    expect(result.passFail.volumeBalancedPace).toBe(false);
    expect(result.passFail.sizeIncreaseAllowed).toBe(false);
    expect(result.issueSignals).toContain("volume_below_required_pace");
    expect(result.issueSignals).toContain("volume_below_balanced_pace");
    expect(result.issueSignals).toContain("adverse_selection_high");
  });
});
