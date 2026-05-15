export interface FundingAccrualSample {
  observedAt: number;
  positionQty: number;
  markPrice: number;
  fundingRateBps: number | null;
}

export interface FundingAccrualEstimate {
  fundingPnlUsd: number;
  coveredMs: number;
  uncoveredMs: number;
  sampleCount: number;
  fundingSampleCount: number;
  averageFundingRateBps: number | null;
}

export function estimateFundingAccrual(
  samples: FundingAccrualSample[],
  endedAt: number,
  rateHorizonSec: number,
): FundingAccrualEstimate {
  const sorted = samples
    .filter((sample) => Number.isFinite(sample.observedAt))
    .sort((left, right) => left.observedAt - right.observedAt);
  let fundingPnlUsd = 0;
  let coveredMs = 0;
  let uncoveredMs = 0;
  const fundingRates: number[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const sample = sorted[index];
    if (sample === undefined) {
      continue;
    }
    const nextObservedAt = sorted[index + 1]?.observedAt ?? endedAt;
    const dtMs = Math.max(0, Math.min(nextObservedAt, endedAt) - sample.observedAt);
    if (dtMs === 0) {
      continue;
    }
    if (
      sample.fundingRateBps === null ||
      !Number.isFinite(sample.fundingRateBps) ||
      !Number.isFinite(sample.positionQty) ||
      !Number.isFinite(sample.markPrice) ||
      rateHorizonSec <= 0
    ) {
      uncoveredMs += dtMs;
      continue;
    }
    fundingRates.push(sample.fundingRateBps);
    coveredMs += dtMs;
    fundingPnlUsd +=
      -sample.positionQty *
      sample.markPrice *
      (sample.fundingRateBps / 10_000) *
      (dtMs / 1000 / rateHorizonSec);
  }

  return {
    fundingPnlUsd,
    coveredMs,
    uncoveredMs,
    sampleCount: sorted.length,
    fundingSampleCount: fundingRates.length,
    averageFundingRateBps: averageOrNull(fundingRates),
  };
}

export function averageOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}
