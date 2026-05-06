export interface MetricsEvaluationInput {
  fillCount: number;
  markoutCoverage: number;
  rawFieldCoverage?: number;
  snapshotFreshnessMs?: number | null;
  netPnl: number;
  tradePnl: number;
  fee: number;
  pnlPerNotional: number;
  maxDrawdown: number;
  avg5sMarkoutBps: number;
  adverseSelectionRate: number;
  spreadCaptureBps?: number;
  fillRate: number;
  rejectRate: number;
  cancelRate: number;
  makerRatio?: number;
  avgLatencyMs?: number;
  positionSkew?: number;
  closeCost?: number;
  warningCount?: number;
  errorCount?: number;
  issueSignals?: string[];
  minMarkoutCoverage?: number;
}

export interface MetricsEvaluation {
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

export function evaluateMetricsRun(input: MetricsEvaluationInput): MetricsEvaluation {
  const minMarkoutCoverage = input.minMarkoutCoverage ?? 0.8;
  const tuningAllowed = input.markoutCoverage >= minMarkoutCoverage && input.fillCount > 0;
  return {
    dataHealth: {
      fillCount: input.fillCount,
      markoutCoverage: input.markoutCoverage,
      rawFieldCoverage: input.rawFieldCoverage ?? 1,
      snapshotFreshnessMs: input.snapshotFreshnessMs ?? null,
    },
    pnl: {
      netPnl: input.netPnl,
      tradePnl: input.tradePnl,
      fee: input.fee,
      pnlPerNotional: input.pnlPerNotional,
      maxDrawdown: input.maxDrawdown,
    },
    markouts: {
      avg5sBps: input.avg5sMarkoutBps,
      adverseSelectionRate: input.adverseSelectionRate,
      spreadCaptureBps: input.spreadCaptureBps ?? 0,
    },
    orderQuality: {
      fillRate: input.fillRate,
      rejectRate: input.rejectRate,
      cancelRate: input.cancelRate,
      makerRatio: input.makerRatio ?? 0,
      avgLatencyMs: input.avgLatencyMs ?? 0,
    },
    inventory: {
      positionSkew: input.positionSkew ?? 0,
      closeCost: input.closeCost ?? 0,
    },
    runtimeHealth: {
      warningCount: input.warningCount ?? 0,
      errorCount: input.errorCount ?? 0,
    },
    tuningAllowed,
    issueSignals: issueSignalsFor(input, minMarkoutCoverage),
  };
}

function issueSignalsFor(input: MetricsEvaluationInput, minMarkoutCoverage: number): string[] {
  const signals = new Set(input.issueSignals ?? []);
  if (input.markoutCoverage < minMarkoutCoverage) {
    signals.add("low_markout_coverage");
  }
  if (
    input.fillCount > 0 &&
    input.markoutCoverage >= minMarkoutCoverage &&
    (input.netPnl <= 0 || input.pnlPerNotional <= 0)
  ) {
    signals.add("strategy_model_gap");
  }
  return [...signals];
}
