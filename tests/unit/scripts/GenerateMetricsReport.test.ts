import { describe, expect, test } from "bun:test";

import { formatMetricsReportMarkdown } from "../../../scripts/generateMetricsReport.ts";
import {
  emptyQuoteFreshness,
  type MetricsEvaluation,
} from "../../../scripts/lib/MetricsEvaluation.ts";
import type { TradingRunFact } from "../../../src/domain/ports/IMetricsRepository.ts";

describe("generateMetricsReport", () => {
  test("prints multi-horizon adverse selection and phase1 volume pace", () => {
    const run: TradingRunFact = {
      id: "run-volume",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "bulk-beta-leaderboard",
      configJson: {},
      gitDirty: false,
      startedAt: 1,
      status: "running",
    };
    const evaluation: MetricsEvaluation = {
      dataHealth: {
        fillCount: 100,
        markoutCoverage: 1,
        markoutCoverageByHorizon: {
          "5s": { observed: 100, total: 100, coverage: 1 },
          "30s": { observed: 90, total: 100, coverage: 0.9 },
          "300s": { observed: 0, total: 100, coverage: 0 },
        },
        rawFieldCoverage: 1,
        snapshotFreshnessMs: 0,
      },
      pnl: {
        netPnl: 10,
        tradePnl: 10,
        fee: 0,
        notionalUsd: 500_000,
        netEvBps: 0.2,
        tradeEvBps: 0.2,
        feeBps: 0,
        pnlPerNotional: 0.00001,
        pnlPerVolumeBps: 0.1,
        maxDrawdown: 0,
      },
      markouts: {
        avg5sBps: -0.6,
        avg30sBps: -0.2,
        avg300sBps: 0.1,
        vw5sBps: -0.4,
        vw30sBps: 0.3,
        vw300sBps: 0.5,
        tail30sBps: { p10: -3, p5: -5, p1: -8, worst: -10 },
        adverseSelectionRate: 0.7,
        adverseSelectionRate5s: 0.7,
        adverseSelectionRate30s: 0.55,
        adverseSelectionRate300s: 0.45,
        spreadCaptureBps: 10,
        realizedSpreadBps: -0.1,
      },
      orderQuality: {
        fillRate: 0.02,
        rejectRate: 0,
        cancelRate: 0.9,
        cancelBeforeFillRate: 0.9,
        makerRatio: 0.8,
        avgLatencyMs: 900,
        avgLiveMs: 5_000,
        avgQuoteAgeMs: 1_200,
        sideImbalance: 0,
      },
      inventory: {
        positionSkew: 0,
        avgAbsPosition: 0.2,
        maxAbsPosition: 0.4,
        reduceCount: 2,
        hardReduceCount: 1,
        minMarginRatio: 0.35,
        closeCost: 0,
      },
      market: {
        avgSpreadBps: 0.1,
        avgQuoteDistanceToMidBps: 7,
        avgQuoteDistanceToBestBps: 7,
        staleRate: 0.3,
      },
      runtimeHealth: { warningCount: 0, errorCount: 0, quoteFreshness: emptyQuoteFreshness() },
      passFail: {
        netPnl: true,
        pnlPerVolumeBps: false,
        avgMarkout30s: false,
        markoutTail: true,
        sideImbalance: true,
        volumeRequiredPace: false,
        volumeBalancedPace: false,
        sizeIncreaseAllowed: false,
      },
      volume: {
        notionalUsd: 500_000,
        targetDays: 15,
        requiredTargetUsd: 50_000_000,
        balancedTargetUsd: 60_000_000,
        projectedTargetUsd: 54_000_000,
        projected14dUsd: 115_000_000,
        projectedShortfallUsd: 0,
        requiredMultiplier: 0.925925926,
        requiredDailyUsd: 3_333_333.3333333335,
        balancedDailyUsd: 4_000_000,
        required14dUsd: 150_000_000,
        balanced14dUsd: 180_000_000,
        rebateReferenceDays: 14,
        rebateReferenceUsd: 150_000_000,
      },
      verdict: "review",
      parameterAction: "hold",
      tuningAllowed: true,
      issueSignals: ["adverse_selection_high"],
    };

    const markdown = formatMetricsReportMarkdown({ run, evaluation });

    expect(markdown).toContain("- Markout coverage 5s: 100.0% (100/100)");
    expect(markdown).toContain("- Markout coverage 30s: 90.0% (90/100)");
    expect(markdown).toContain("- Markout coverage 300s: 0.0% (0/100)");
    expect(markdown).toContain("- Adverse selection 5s: 70.0%");
    expect(markdown).toContain("- Adverse selection 30s: 55.0%");
    expect(markdown).toContain("- Adverse selection 300s: 45.0%");
    expect(markdown).toContain("- VW 5s markout: -0.4000 bps");
    expect(markdown).toContain("- VW 30s markout: 0.3000 bps");
    expect(markdown).toContain("- VW 300s markout: 0.5000 bps");
    expect(markdown).toContain(
      "- 30s markout tail: p10=-3.0000 bps, p5=-5.0000 bps, p1=-8.0000 bps, worst=-10.0000 bps",
    );
    expect(markdown).toContain("- Notional: 500000.00");
    expect(markdown).toContain("- Net EV: 0.2000 bps");
    expect(markdown).toContain("- Trade EV: 0.2000 bps");
    expect(markdown).toContain("- Fee/Rebate: 0.0000 bps");
    expect(markdown).toContain("- Avg quote age at fill: 1200.00 ms");
    expect(markdown).toContain("- Max abs position: 0.400000");
    expect(markdown).toContain("- Avg abs position: 0.200000");
    expect(markdown).toContain("- Reduce count: 2");
    expect(markdown).toContain("- Hard reduce count: 1");
    expect(markdown).toContain("- Min margin ratio: 35.0%");
    expect(markdown).toContain("- Phase1 required 15d volume: 50000000.00");
    expect(markdown).toContain("- Phase1 projected 15d volume: 54000000.00");
    expect(markdown).toContain("- Required multiplier: 0.93x");
    expect(markdown).toContain("- Required hourly volume: 138888.89");
    expect(markdown).toContain("- Required minute volume: 2314.81");
    expect(markdown).toContain("- Rebate reference 14d volume: 150000000.00");
    expect(markdown).toContain("- Rebate projected 14d volume: 115000000.00");
    expect(markdown).toContain("## Quote Freshness");
    expect(markdown).toContain("- Samples: 0");
    expect(markdown).toContain("- Total refresh ms: p50=n/a p95=n/a max=n/a");
    expect(markdown).toContain("- Slow cycle rate: n/a");
  });

  test("prints bucket evidence when available", () => {
    const run: TradingRunFact = {
      id: "run-buckets",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 1,
      status: "completed",
    };
    const evaluation = minimalEvaluation();

    const markdown = formatMetricsReportMarkdown({
      run,
      evaluation,
      bucketEvidence: {
        sideIntent: [
          {
            bucket: "buy:quote",
            fillCount: 2,
            notionalUsd: 20_000,
            netPnl: -4,
            pnlPerVolumeBps: -2,
            avg5sMarkoutBps: -1,
            avg30sMarkoutBps: -2,
            avg300sMarkoutBps: null,
            vw5sMarkoutBps: -1,
            vw30sMarkoutBps: -2,
            vw300sMarkoutBps: null,
            p5Markout30sBps: -3,
            p1Markout30sBps: -5,
            adverseSelectionRate5s: 1,
            adverseSelectionRate30s: 1,
            adverseSelectionRate300s: null,
            avgOrderLiveMs: 5000,
          },
        ],
        quoteLevel: [],
        quoteAge: [],
      },
    });

    expect(markdown).toContain("## Bucket Evidence");
    expect(markdown).toContain(
      "| buy:quote | 2 | 20000.00 | -1.0000 | -2.0000 | -3.0000 | -5.0000 | -2.0000 |",
    );
  });

  test("prints quote freshness telemetry", () => {
    const run: TradingRunFact = {
      id: "run-freshness",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 1,
      status: "completed",
    };
    const evaluation = minimalEvaluation();
    evaluation.runtimeHealth.quoteFreshness = {
      sampleCount: 5,
      totalRefreshMsP50: 40,
      totalRefreshMsP95: 120,
      totalRefreshMsMax: 150,
      qualityGateMsP95: 12,
      recordQuoteMsP95: 18,
      reconcileMsP95: 70,
      bookAgeMsAtDecisionP95: 250,
      midMoveDuringRefreshBpsP95Abs: 4.5,
      slowCycleRate: 0.2,
    };

    const markdown = formatMetricsReportMarkdown({ run, evaluation });

    expect(markdown).toContain("## Quote Freshness");
    expect(markdown).toContain("- Samples: 5");
    expect(markdown).toContain("- Total refresh ms: p50=40.00 p95=120.00 max=150.00");
    expect(markdown).toContain("- Quality gate p95: 12 ms");
    expect(markdown).toContain("- Record quote p95: 18 ms");
    expect(markdown).toContain("- Reconcile p95: 70 ms");
    expect(markdown).toContain("- Mid-move p95 abs: 4.5000 bps");
    expect(markdown).toContain("- Slow cycle rate: 20.0%");
  });

  test("prints old evaluation JSON when quote freshness is missing", () => {
    const run: TradingRunFact = {
      id: "run-old-evaluation",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 1,
      status: "completed",
    };
    const evaluation = minimalEvaluation();
    delete evaluation.runtimeHealth.quoteFreshness;

    const markdown = formatMetricsReportMarkdown({ run, evaluation });

    expect(markdown).toContain("## Quote Freshness");
    expect(markdown).toContain("- Samples: 0");
  });
});

function minimalEvaluation(): MetricsEvaluation {
  return {
    dataHealth: {
      fillCount: 0,
      markoutCoverage: 0,
      markoutCoverageByHorizon: {
        "5s": { observed: 0, total: 0, coverage: 0 },
        "30s": { observed: 0, total: 0, coverage: 0 },
        "300s": { observed: 0, total: 0, coverage: 0 },
      },
      rawFieldCoverage: 1,
      snapshotFreshnessMs: 0,
    },
    pnl: {
      netPnl: 0,
      tradePnl: 0,
      fee: 0,
      notionalUsd: null,
      netEvBps: null,
      tradeEvBps: null,
      feeBps: null,
      pnlPerNotional: 0,
      pnlPerVolumeBps: 0,
      maxDrawdown: 0,
    },
    markouts: {
      avg5sBps: 0,
      avg30sBps: null,
      avg300sBps: null,
      vw5sBps: null,
      vw30sBps: null,
      vw300sBps: null,
      tail30sBps: { p10: 0, p5: 0, p1: 0, worst: 0 },
      adverseSelectionRate: 0,
      adverseSelectionRate5s: 0,
      adverseSelectionRate30s: null,
      adverseSelectionRate300s: null,
      spreadCaptureBps: 0,
      realizedSpreadBps: 0,
    },
    orderQuality: {
      fillRate: 0,
      rejectRate: 0,
      cancelRate: 0,
      cancelBeforeFillRate: 0,
      makerRatio: 0,
      avgLatencyMs: 0,
      avgLiveMs: 0,
      avgQuoteAgeMs: null,
      sideImbalance: 0,
    },
    inventory: {
      positionSkew: 0,
      avgAbsPosition: null,
      maxAbsPosition: null,
      reduceCount: 0,
      hardReduceCount: 0,
      minMarginRatio: null,
      closeCost: 0,
    },
    market: {
      avgSpreadBps: 0,
      avgQuoteDistanceToMidBps: 0,
      avgQuoteDistanceToBestBps: 0,
      staleRate: 0,
    },
    runtimeHealth: { warningCount: 0, errorCount: 0, quoteFreshness: emptyQuoteFreshness() },
    passFail: {
      netPnl: false,
      pnlPerVolumeBps: false,
      avgMarkout30s: false,
      markoutTail: false,
      sideImbalance: false,
      volumeRequiredPace: false,
      volumeBalancedPace: false,
      sizeIncreaseAllowed: false,
    },
    volume: {
      notionalUsd: null,
      targetDays: 15,
      requiredTargetUsd: 50_000_000,
      balancedTargetUsd: 60_000_000,
      projectedTargetUsd: null,
      projected14dUsd: null,
      projectedShortfallUsd: null,
      requiredMultiplier: null,
      requiredDailyUsd: 3_333_333.3333333335,
      balancedDailyUsd: 4_000_000,
      required14dUsd: 150_000_000,
      balanced14dUsd: 180_000_000,
      rebateReferenceDays: 14,
      rebateReferenceUsd: 150_000_000,
    },
    verdict: "review",
    parameterAction: "blocked_by_data_health",
    tuningAllowed: false,
    issueSignals: [],
  };
}
