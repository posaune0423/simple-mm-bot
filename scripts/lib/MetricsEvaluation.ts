interface MetricsEvaluationInput {
  fillCount: number;
  markoutCoverage: number;
  markoutCoverageByHorizon?: MarkoutCoverageByHorizon;
  rawFieldCoverage?: number;
  snapshotFreshnessMs?: number | null;
  notionalUsd?: number;
  windowDays?: number;
  requiredVolumeUsd?: number;
  balancedVolumeUsd?: number;
  volumeTargetDays?: number;
  required14dVolumeUsd?: number;
  balanced14dVolumeUsd?: number;
  netPnl: number;
  tradePnl: number;
  fee: number;
  pnlPerNotional: number;
  pnlPerVolumeBps?: number;
  maxDrawdown: number;
  avg5sMarkoutBps: number;
  avg30sMarkoutBps?: number | null;
  avg300sMarkoutBps?: number | null;
  vw5sMarkoutBps?: number | null;
  vw30sMarkoutBps?: number | null;
  vw300sMarkoutBps?: number | null;
  markout30sTailBps?: MarkoutTailBps;
  adverseSelectionRate: number;
  adverseSelectionRate5s?: number | null;
  adverseSelectionRate30s?: number | null;
  adverseSelectionRate300s?: number | null;
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
  avgQuoteAgeMs?: number | null;
  positionSkew?: number;
  avgAbsPosition?: number | null;
  maxAbsPosition?: number | null;
  reduceCount?: number | null;
  hardReduceCount?: number;
  minMarginRatio?: number | null;
  avgQuoteDistanceToMidBps?: number;
  avgQuoteDistanceToBestBps?: number;
  closeCost?: number;
  warningCount?: number;
  errorCount?: number;
  issueSignals?: string[];
  minFillCount?: number;
  minMarkoutCoverage?: number;
  quoteFreshness?: Partial<QuoteCycleFreshnessMetrics> & { sampleCount: number };
}

export interface BucketEvidenceRow {
  bucket: string;
  fillCount: number;
  notionalUsd: number;
  netPnl: number;
  pnlPerVolumeBps: number | null;
  avg5sMarkoutBps: number | null;
  avg30sMarkoutBps: number | null;
  avg300sMarkoutBps: number | null;
  vw5sMarkoutBps: number | null;
  vw30sMarkoutBps: number | null;
  vw300sMarkoutBps: number | null;
  adverseSelectionRate5s: number | null;
  adverseSelectionRate30s: number | null;
  adverseSelectionRate300s: number | null;
  p5Markout30sBps: number | null;
  p1Markout30sBps: number | null;
  avgOrderLiveMs: number | null;
}

export interface BucketEvidence {
  sideIntent: BucketEvidenceRow[];
  quoteLevel: BucketEvidenceRow[];
  quoteAge: BucketEvidenceRow[];
}

interface MarkoutTailBps {
  p10: number;
  p5: number;
  p1?: number | null;
  worst: number;
}

interface MarkoutCoverage {
  observed: number;
  total: number;
  coverage: number;
}

interface MarkoutCoverageByHorizon {
  "5s": MarkoutCoverage;
  "30s": MarkoutCoverage;
  "300s": MarkoutCoverage;
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
    markoutCoverageByHorizon: MarkoutCoverageByHorizon;
    rawFieldCoverage: number;
    snapshotFreshnessMs: number | null;
  };
  pnl: {
    notionalUsd: number | null;
    netPnl: number;
    tradePnl: number;
    fee: number;
    netEvBps: number | null;
    tradeEvBps: number | null;
    feeBps: number | null;
    pnlPerNotional: number;
    pnlPerVolumeBps: number;
    maxDrawdown: number;
  };
  markouts: {
    avg5sBps: number;
    avg30sBps: number | null;
    avg300sBps: number | null;
    vw5sBps: number | null;
    vw30sBps: number | null;
    vw300sBps: number | null;
    tail30sBps: MarkoutTailBps;
    adverseSelectionRate: number;
    adverseSelectionRate5s: number;
    adverseSelectionRate30s: number | null;
    adverseSelectionRate300s: number | null;
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
    avgQuoteAgeMs: number | null;
    sideImbalance: number;
  };
  inventory: {
    positionSkew: number;
    avgAbsPosition: number | null;
    maxAbsPosition: number | null;
    reduceCount: number;
    hardReduceCount: number;
    minMarginRatio: number | null;
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
    quoteFreshness?: QuoteCycleFreshnessMetrics;
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
    targetDays: number;
    requiredTargetUsd: number;
    balancedTargetUsd: number;
    projectedTargetUsd: number | null;
    projected14dUsd: number | null;
    projectedShortfallUsd: number | null;
    requiredMultiplier: number | null;
    requiredDailyUsd: number;
    balancedDailyUsd: number;
    required14dUsd: number;
    balanced14dUsd: number;
    rebateReferenceDays: number;
    rebateReferenceUsd: number;
  };
  verdict: "pass" | "review";
  parameterAction: ParameterAction;
  tuningAllowed: boolean;
  issueSignals: string[];
}

export function evaluateMetricsRun(input: MetricsEvaluationInput): MetricsEvaluation {
  const minFillCount = input.minFillCount ?? 3;
  const minMarkoutCoverage = input.minMarkoutCoverage ?? 0.8;
  const markoutCoverageByHorizon = normalizedMarkoutCoverage(input);
  const tuningAllowed =
    input.fillCount >= minFillCount && input.markoutCoverage >= minMarkoutCoverage;
  return {
    dataHealth: {
      fillCount: input.fillCount,
      markoutCoverage: input.markoutCoverage,
      markoutCoverageByHorizon,
      rawFieldCoverage: input.rawFieldCoverage ?? 1,
      snapshotFreshnessMs: input.snapshotFreshnessMs ?? null,
    },
    pnl: {
      notionalUsd: input.notionalUsd ?? null,
      netPnl: input.netPnl,
      tradePnl: input.tradePnl,
      fee: input.fee,
      netEvBps: evBps(input.netPnl, input.notionalUsd),
      tradeEvBps: evBps(input.tradePnl, input.notionalUsd),
      feeBps: evBps(input.fee, input.notionalUsd),
      pnlPerNotional: input.pnlPerNotional,
      pnlPerVolumeBps: input.pnlPerVolumeBps ?? input.pnlPerNotional * 10_000,
      maxDrawdown: input.maxDrawdown,
    },
    markouts: {
      avg5sBps: input.avg5sMarkoutBps,
      avg30sBps: input.avg30sMarkoutBps ?? null,
      avg300sBps: input.avg300sMarkoutBps ?? null,
      vw5sBps: input.vw5sMarkoutBps ?? null,
      vw30sBps: input.vw30sMarkoutBps ?? null,
      vw300sBps: input.vw300sMarkoutBps ?? null,
      tail30sBps: input.markout30sTailBps ?? { p10: 0, p5: 0, worst: 0 },
      adverseSelectionRate: input.adverseSelectionRate,
      adverseSelectionRate5s: input.adverseSelectionRate5s ?? input.adverseSelectionRate,
      adverseSelectionRate30s: input.adverseSelectionRate30s ?? null,
      adverseSelectionRate300s: input.adverseSelectionRate300s ?? null,
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
      avgQuoteAgeMs: input.avgQuoteAgeMs ?? null,
      sideImbalance: input.sideImbalance ?? 0,
    },
    inventory: {
      positionSkew: input.positionSkew ?? 0,
      avgAbsPosition: input.avgAbsPosition ?? null,
      maxAbsPosition: input.maxAbsPosition ?? null,
      reduceCount: input.reduceCount ?? 0,
      hardReduceCount: input.hardReduceCount ?? 0,
      minMarginRatio: input.minMarginRatio ?? null,
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
      quoteFreshness: {
        ...emptyQuoteFreshness(),
        ...input.quoteFreshness,
      },
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
  const avgMarkout30s = input.avg30sMarkoutBps;
  const tail = input.markout30sTailBps ?? { p10: 0, p5: 0, worst: 0 };
  const volume = volumeFor(input);
  return {
    netPnl: input.netPnl >= 0,
    pnlPerVolumeBps: pnlPerVolumeBps >= 5,
    avgMarkout30s: avgMarkout30s !== null && avgMarkout30s !== undefined && avgMarkout30s >= 0,
    markoutTail: tail.p10 >= -150,
    sideImbalance: Math.abs(input.sideImbalance ?? 0) < 0.7,
    volumeRequiredPace:
      volume.projectedTargetUsd === null ||
      volume.projectedTargetUsd >= inputRequiredTargetVolume(input),
    volumeBalancedPace:
      volume.projectedTargetUsd === null ||
      volume.projectedTargetUsd >= inputBalancedTargetVolume(input),
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
  const coverage = normalizedMarkoutCoverage(input);
  if (coverage["30s"].coverage < minMarkoutCoverage) {
    signals.add("low_markout_30s_coverage");
  }
  if (coverage["300s"].coverage < minMarkoutCoverage) {
    signals.add("low_markout_300s_coverage");
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

function normalizedMarkoutCoverage(input: MetricsEvaluationInput): MarkoutCoverageByHorizon {
  if (input.markoutCoverageByHorizon !== undefined) {
    return input.markoutCoverageByHorizon;
  }
  const observed = Math.round(input.fillCount * input.markoutCoverage);
  const fallback = {
    observed,
    total: input.fillCount,
    coverage: input.markoutCoverage,
  };
  return {
    "5s": fallback,
    "30s": fallback,
    "300s": fallback,
  };
}

function volumeFor(input: MetricsEvaluationInput): MetricsEvaluation["volume"] {
  const targetDays = Math.max(inputVolumeTargetDays(input), 1);
  const requiredTargetUsd = inputRequiredTargetVolume(input);
  const balancedTargetUsd = inputBalancedTargetVolume(input);
  const requiredDailyUsd = requiredTargetUsd / targetDays;
  const balancedDailyUsd = balancedTargetUsd / targetDays;
  const rebateReferenceDays = 14;
  const rebateReferenceUsd = inputRebateReferenceVolume(input);
  const balanced14dUsd = inputBalanced14dVolume(input);
  if (input.notionalUsd === undefined || input.windowDays === undefined || input.windowDays <= 0) {
    return {
      notionalUsd: input.notionalUsd ?? null,
      targetDays,
      requiredTargetUsd,
      balancedTargetUsd,
      projectedTargetUsd: null,
      projected14dUsd: null,
      projectedShortfallUsd: null,
      requiredMultiplier: null,
      requiredDailyUsd,
      balancedDailyUsd,
      required14dUsd: rebateReferenceUsd,
      balanced14dUsd,
      rebateReferenceDays,
      rebateReferenceUsd,
    };
  }
  const dailyPaceUsd = input.notionalUsd / input.windowDays;
  const projectedTargetUsd = dailyPaceUsd * targetDays;
  const projected14dUsd = dailyPaceUsd * rebateReferenceDays;

  return {
    notionalUsd: input.notionalUsd,
    targetDays,
    requiredTargetUsd,
    balancedTargetUsd,
    projectedTargetUsd,
    projected14dUsd,
    projectedShortfallUsd: Math.max(0, requiredTargetUsd - projectedTargetUsd),
    requiredMultiplier: projectedTargetUsd > 0 ? requiredTargetUsd / projectedTargetUsd : null,
    requiredDailyUsd,
    balancedDailyUsd,
    required14dUsd: rebateReferenceUsd,
    balanced14dUsd,
    rebateReferenceDays,
    rebateReferenceUsd,
  };
}

function inputVolumeTargetDays(input: MetricsEvaluationInput): number {
  return input.volumeTargetDays ?? 15;
}

function inputRequiredTargetVolume(input: MetricsEvaluationInput): number {
  return input.requiredVolumeUsd ?? 50_000_000;
}

function inputBalancedTargetVolume(input: MetricsEvaluationInput): number {
  return input.balancedVolumeUsd ?? 60_000_000;
}

function inputRebateReferenceVolume(input: MetricsEvaluationInput): number {
  return input.required14dVolumeUsd ?? 150_000_000;
}

function inputBalanced14dVolume(input: MetricsEvaluationInput): number {
  return input.balanced14dVolumeUsd ?? 180_000_000;
}

function evBps(value: number, notionalUsd: number | undefined): number | null {
  if (notionalUsd === undefined || notionalUsd <= 0) {
    return null;
  }
  return (value / notionalUsd) * 10_000;
}

export function emptyQuoteFreshness(): QuoteCycleFreshnessMetrics {
  return {
    sampleCount: 0,
    totalCycleMsP50: null,
    totalCycleMsP95: null,
    totalCycleMsMax: null,
    qualityGateMsP95: null,
    recordQuoteMsP95: null,
    reconcileMsP95: null,
    bookAgeMsAtDecisionP95: null,
    midMoveDuringCycleBpsP95Abs: null,
    slowCycleRate: null,
  };
}

interface QuoteCycleFreshnessMetrics {
  sampleCount: number;
  totalCycleMsP50: number | null;
  totalCycleMsP95: number | null;
  totalCycleMsMax: number | null;
  qualityGateMsP95: number | null;
  recordQuoteMsP95: number | null;
  reconcileMsP95: number | null;
  bookAgeMsAtDecisionP95: number | null;
  midMoveDuringCycleBpsP95Abs: number | null;
  slowCycleRate: number | null;
}
