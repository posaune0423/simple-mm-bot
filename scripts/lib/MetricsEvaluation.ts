export interface MetricsEvaluationInput {
  fillCount: number;
  markoutCoverage: number;
  rawFieldCoverage?: number;
  snapshotFreshnessMs?: number | null;
  notionalUsd?: number;
  windowDays?: number;
  required14dVolumeUsd?: number;
  balanced14dVolumeUsd?: number;
  netPnl: number;
  tradePnl: number;
  fee: number;
  pnlPerNotional: number;
  pnlPerVolumeBps?: number;
  maxDrawdown: number;
  avg5sMarkoutBps: number;
  avg30sMarkoutBps?: number;
  avg300sMarkoutBps?: number;
  markout30sTailBps?: MarkoutTailBps;
  adverseSelectionRate: number;
  spreadCaptureBps?: number;
  realizedSpreadBps?: number;
  sideImbalance?: number;
  avgMarketSpreadBps?: number;
  staleRate?: number;
  fillRate: number;
  rejectRate: number;
  cancelRate: number;
  cancelBeforeFillRate?: number;
  makerRatio?: number;
  avgLatencyMs?: number;
  avgOrderLiveMs?: number;
  positionSkew?: number;
  avgQuoteDistanceToMidBps?: number;
  avgQuoteDistanceToBestBps?: number;
  closeCost?: number;
  warningCount?: number;
  errorCount?: number;
  issueSignals?: string[];
  minFillCount?: number;
  minMarkoutCoverage?: number;
}

export interface MarkoutTailBps {
  p10: number;
  p5: number;
  worst: number;
}

type ParameterAction =
  | "hold"
  | "blocked_by_data_health"
  | "widen_spread_or_increase_gamma"
  | "increase_k_inv"
  | "reduce_size_or_budget"
  | "tighten_spread";

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
    pnlPerVolumeBps: number;
    maxDrawdown: number;
  };
  markouts: {
    avg5sBps: number;
    avg30sBps: number;
    avg300sBps: number;
    tail30sBps: MarkoutTailBps;
    adverseSelectionRate: number;
    spreadCaptureBps: number;
    realizedSpreadBps: number;
  };
  orderQuality: {
    fillRate: number;
    rejectRate: number;
    cancelRate: number;
    cancelBeforeFillRate: number;
    makerRatio: number;
    avgLatencyMs: number;
    avgLiveMs: number;
    sideImbalance: number;
  };
  inventory: {
    positionSkew: number;
    closeCost: number;
  };
  market: {
    avgSpreadBps: number;
    avgQuoteDistanceToMidBps: number;
    avgQuoteDistanceToBestBps: number;
    staleRate: number;
  };
  runtimeHealth: {
    warningCount: number;
    errorCount: number;
  };
  passFail: {
    netPnl: boolean;
    pnlPerVolumeBps: boolean;
    avgMarkout30s: boolean;
    markoutTail: boolean;
    sideImbalance: boolean;
    volumeRequiredPace: boolean;
    volumeBalancedPace: boolean;
    sizeIncreaseAllowed: boolean;
  };
  volume: {
    notionalUsd: number | null;
    projected14dUsd: number | null;
    requiredDailyUsd: number;
    balancedDailyUsd: number;
  };
  verdict: "pass" | "review";
  parameterAction: ParameterAction;
  tuningAllowed: boolean;
  issueSignals: string[];
}

export function evaluateMetricsRun(input: MetricsEvaluationInput): MetricsEvaluation {
  const minFillCount = input.minFillCount ?? 3;
  const minMarkoutCoverage = input.minMarkoutCoverage ?? 0.8;
  const tuningAllowed =
    input.fillCount >= minFillCount && input.markoutCoverage >= minMarkoutCoverage;
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
      pnlPerVolumeBps: input.pnlPerVolumeBps ?? input.pnlPerNotional * 10_000,
      maxDrawdown: input.maxDrawdown,
    },
    markouts: {
      avg5sBps: input.avg5sMarkoutBps,
      avg30sBps: input.avg30sMarkoutBps ?? 0,
      avg300sBps: input.avg300sMarkoutBps ?? 0,
      tail30sBps: input.markout30sTailBps ?? { p10: 0, p5: 0, worst: 0 },
      adverseSelectionRate: input.adverseSelectionRate,
      spreadCaptureBps: input.spreadCaptureBps ?? 0,
      realizedSpreadBps: input.realizedSpreadBps ?? 0,
    },
    orderQuality: {
      fillRate: input.fillRate,
      rejectRate: input.rejectRate,
      cancelRate: input.cancelRate,
      cancelBeforeFillRate: input.cancelBeforeFillRate ?? 0,
      makerRatio: input.makerRatio ?? 0,
      avgLatencyMs: input.avgLatencyMs ?? 0,
      avgLiveMs: input.avgOrderLiveMs ?? 0,
      sideImbalance: input.sideImbalance ?? 0,
    },
    inventory: {
      positionSkew: input.positionSkew ?? 0,
      closeCost: input.closeCost ?? 0,
    },
    market: {
      avgSpreadBps: input.avgMarketSpreadBps ?? 0,
      avgQuoteDistanceToMidBps: input.avgQuoteDistanceToMidBps ?? 0,
      avgQuoteDistanceToBestBps: input.avgQuoteDistanceToBestBps ?? 0,
      staleRate: input.staleRate ?? 0,
    },
    runtimeHealth: {
      warningCount: input.warningCount ?? 0,
      errorCount: input.errorCount ?? 0,
    },
    volume: volumeFor(input),
    passFail: passFailFor(input),
    verdict: verdictFor(input),
    parameterAction: parameterActionFor(input, tuningAllowed),
    tuningAllowed,
    issueSignals: issueSignalsFor(input, minFillCount, minMarkoutCoverage),
  };
}

function passFailFor(input: MetricsEvaluationInput): MetricsEvaluation["passFail"] {
  const pnlPerVolumeBps = input.pnlPerVolumeBps ?? input.pnlPerNotional * 10_000;
  const avgMarkout30s = input.avg30sMarkoutBps ?? 0;
  const tail = input.markout30sTailBps ?? { p10: 0, p5: 0, worst: 0 };
  const volume = volumeFor(input);
  return {
    netPnl: input.netPnl >= 0,
    pnlPerVolumeBps: pnlPerVolumeBps >= 5,
    avgMarkout30s: avgMarkout30s >= -5,
    markoutTail: tail.p10 >= -150,
    sideImbalance: Math.abs(input.sideImbalance ?? 0) < 0.7,
    volumeRequiredPace:
      volume.projected14dUsd === null || volume.projected14dUsd >= inputRequired14dVolume(input),
    volumeBalancedPace:
      volume.projected14dUsd === null || volume.projected14dUsd >= inputBalanced14dVolume(input),
    sizeIncreaseAllowed:
      input.netPnl > 0 &&
      pnlPerVolumeBps > 0 &&
      input.avg5sMarkoutBps > 0.5 &&
      input.adverseSelectionRate < 0.3,
  };
}

function verdictFor(input: MetricsEvaluationInput): MetricsEvaluation["verdict"] {
  const passFail = passFailFor(input);
  return passFail.netPnl &&
    passFail.pnlPerVolumeBps &&
    passFail.avgMarkout30s &&
    passFail.markoutTail &&
    passFail.sideImbalance &&
    passFail.volumeRequiredPace
    ? "pass"
    : "review";
}

function parameterActionFor(
  input: MetricsEvaluationInput,
  tuningAllowed: boolean,
): ParameterAction {
  if (!tuningAllowed) {
    return "blocked_by_data_health";
  }
  const tail = input.markout30sTailBps ?? { p10: 0, p5: 0, worst: 0 };
  if ((input.avg30sMarkoutBps ?? 0) < -5 || tail.p10 < -150 || tail.p5 < -150) {
    return "widen_spread_or_increase_gamma";
  }
  if (Math.abs(input.positionSkew ?? 0) > 0.5) {
    return "increase_k_inv";
  }
  if (input.maxDrawdown > 5) {
    return "reduce_size_or_budget";
  }
  if (
    input.netPnl >= 0 &&
    (input.pnlPerVolumeBps ?? input.pnlPerNotional * 10_000) >= 5 &&
    (input.avg30sMarkoutBps ?? 0) >= 0 &&
    input.fillRate < 0.05
  ) {
    return "tighten_spread";
  }
  return "hold";
}

function issueSignalsFor(
  input: MetricsEvaluationInput,
  minFillCount: number,
  minMarkoutCoverage: number,
): string[] {
  const signals = new Set(input.issueSignals ?? []);
  if (input.fillCount < minFillCount) {
    signals.add("low_fill_count");
  }
  if (input.markoutCoverage < minMarkoutCoverage) {
    signals.add("low_markout_coverage");
  }
  if ((input.cancelBeforeFillRate ?? input.cancelRate) >= 0.8) {
    signals.add("high_cancel_churn");
  }
  if ((input.avgOrderLiveMs ?? Number.POSITIVE_INFINITY) < 1000) {
    signals.add("short_order_lifetime");
  }
  if ((input.avgQuoteDistanceToBestBps ?? 0) > Math.max((input.avgMarketSpreadBps ?? 0) * 5, 5)) {
    signals.add("quotes_far_from_touch");
  }
  if (
    input.fillCount >= minFillCount &&
    input.markoutCoverage >= minMarkoutCoverage &&
    (input.netPnl <= 0 || input.pnlPerNotional <= 0)
  ) {
    signals.add("strategy_model_gap");
  }
  const passFail = passFailFor(input);
  if (!passFail.volumeRequiredPace) {
    signals.add("volume_below_required_pace");
  }
  if (!passFail.volumeBalancedPace) {
    signals.add("volume_below_balanced_pace");
  }
  if (input.adverseSelectionRate >= 0.3) {
    signals.add("adverse_selection_high");
  }
  if (!passFail.sizeIncreaseAllowed) {
    signals.add("size_increase_blocked");
  }
  return [...signals];
}

function volumeFor(input: MetricsEvaluationInput): MetricsEvaluation["volume"] {
  const requiredDailyUsd = inputRequired14dVolume(input) / 14;
  const balancedDailyUsd = inputBalanced14dVolume(input) / 14;
  if (input.notionalUsd === undefined || input.windowDays === undefined || input.windowDays <= 0) {
    return {
      notionalUsd: input.notionalUsd ?? null,
      projected14dUsd: null,
      requiredDailyUsd,
      balancedDailyUsd,
    };
  }

  return {
    notionalUsd: input.notionalUsd,
    projected14dUsd: (input.notionalUsd / input.windowDays) * 14,
    requiredDailyUsd,
    balancedDailyUsd,
  };
}

function inputRequired14dVolume(input: MetricsEvaluationInput): number {
  return input.required14dVolumeUsd ?? 150_000_000;
}

function inputBalanced14dVolume(input: MetricsEvaluationInput): number {
  return input.balanced14dVolumeUsd ?? 180_000_000;
}
