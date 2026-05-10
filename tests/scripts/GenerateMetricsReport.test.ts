import { describe, expect, test } from "bun:test";

import { formatMetricsReportMarkdown } from "../../scripts/generateMetricsReport.ts";
import type { MetricsEvaluation } from "../../scripts/lib/MetricsEvaluation.ts";
import type { TradingRunFact } from "../../src/domain/ports/IMetricsRepository.ts";

describe("generateMetricsReport", () => {
  test("prints multi-horizon adverse selection and 14d volume pace", () => {
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
        tail30sBps: { p10: -3, p5: -5, worst: -10 },
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
        sideImbalance: 0,
      },
      inventory: { positionSkew: 0, closeCost: 0 },
      market: {
        avgSpreadBps: 0.1,
        avgQuoteDistanceToMidBps: 7,
        avgQuoteDistanceToBestBps: 7,
        staleRate: 0.3,
      },
      runtimeHealth: { warningCount: 0, errorCount: 0 },
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
        projected14dUsd: 115_000_000,
        projectedShortfallUsd: 35_000_000,
        requiredMultiplier: 1.304347826,
        requiredDailyUsd: 10_714_285.714285715,
        balancedDailyUsd: 12_857_142.857142856,
        required14dUsd: 150_000_000,
        balanced14dUsd: 180_000_000,
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
    expect(markdown).toContain("- Required 14d volume: 150000000.00");
    expect(markdown).toContain("- Projected 14d volume: 115000000.00");
    expect(markdown).toContain("- Required multiplier: 1.30x");
    expect(markdown).toContain("- Required hourly volume: 446428.57");
    expect(markdown).toContain("- Required minute volume: 7440.48");
  });
});
