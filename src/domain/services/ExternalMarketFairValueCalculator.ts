import type {
  ExternalMarketSourceConfig,
  ExternalTopOfBook,
} from "../external-market/ExternalMarketTypes.ts";
import type {
  FairValueComponent,
  FairValueExclusion,
  FairValueExclusionReason,
  FairValueSnapshot,
} from "../external-market/FairValueTypes.ts";

export type ExternalMarketFairValueConfig = Readonly<{
  sources: readonly ExternalMarketSourceConfig[];
  maxAgeMs: number;
  minSourceCount: number;
  maxSpreadBps: number;
  maxDeviationBps: number;
}>;

type Candidate = FairValueComponent & Readonly<{ configuredWeight: number }>;

export class ExternalMarketFairValueCalculator {
  constructor(private readonly config: ExternalMarketFairValueConfig) {}

  compute(latest: readonly (ExternalTopOfBook | undefined)[], nowMs: number): FairValueSnapshot {
    const excluded: FairValueExclusion[] = [];
    const candidates: Candidate[] = [];

    for (let index = 0; index < this.config.sources.length; index += 1) {
      const source = this.config.sources[index];
      if (source === undefined) {
        continue;
      }
      const book = latest[index];
      if (book === undefined) {
        excluded.push(exclusion(source, "missing"));
        continue;
      }

      const invalidReason = invalidBboReason(book);
      if (invalidReason !== undefined) {
        excluded.push(exclusion(source, invalidReason));
        continue;
      }

      const ageMs = Math.max(0, nowMs - book.receivedAt);
      if (ageMs > this.config.maxAgeMs) {
        excluded.push(exclusion(source, "stale"));
        continue;
      }

      const spreadBps = finiteOr(book.spreadBps, spreadBpsOf(book));
      if (spreadBps > this.config.maxSpreadBps) {
        excluded.push(exclusion(source, "wide_spread"));
        continue;
      }

      candidates.push({
        venue: source.venue,
        symbol: source.symbol,
        bidPrice: book.bidPrice,
        askPrice: book.askPrice,
        midPrice: book.midPrice,
        ageMs,
        spreadBps,
        weight: source.weight,
        configuredWeight: source.weight,
      });
    }

    const medianMid = median(candidates.map((candidate) => candidate.midPrice));
    const filtered = candidates.filter((candidate) => {
      if (medianMid === undefined) {
        return true;
      }
      const deviationBps = Math.abs((candidate.midPrice - medianMid) / medianMid) * 10_000;
      if (deviationBps <= this.config.maxDeviationBps) {
        return true;
      }
      excluded.push(exclusion(candidate, "outlier"));
      return false;
    });

    const weightedCandidates = filtered.filter((candidate) => {
      if (Number.isFinite(candidate.configuredWeight) && candidate.configuredWeight > 0) {
        return true;
      }
      excluded.push(exclusion(candidate, "invalid_weight"));
      return false;
    });

    if (weightedCandidates.length < this.config.minSourceCount) {
      return {
        status: "unavailable",
        computedAt: nowMs,
        used: [],
        excluded,
      };
    }

    const totalWeight = weightedCandidates.reduce(
      (sum, candidate) => sum + candidate.configuredWeight,
      0,
    );
    const useEqualWeights = !Number.isFinite(totalWeight) || totalWeight <= 0;
    const used = weightedCandidates.map(({ configuredWeight, ...candidate }) => ({
      ...candidate,
      weight: useEqualWeights ? 1 / weightedCandidates.length : configuredWeight / totalWeight,
    }));

    return {
      status: used.length === this.config.sources.length ? "ready" : "degraded",
      computedAt: nowMs,
      fairBid: weightedAverage(used, (source) => source.bidPrice),
      fairAsk: weightedAverage(used, (source) => source.askPrice),
      fairMid: weightedAverage(used, (source) => source.midPrice),
      minAgeMs: Math.min(...used.map((source) => source.ageMs)),
      maxAgeMs: Math.max(...used.map((source) => source.ageMs)),
      used,
      excluded,
    };
  }
}

function invalidBboReason(book: ExternalTopOfBook): FairValueExclusionReason | undefined {
  if (
    !Number.isFinite(book.bidPrice) ||
    !Number.isFinite(book.askPrice) ||
    !Number.isFinite(book.bidSize) ||
    !Number.isFinite(book.askSize) ||
    !Number.isFinite(book.midPrice) ||
    book.bidPrice <= 0 ||
    book.askPrice <= 0 ||
    book.bidSize <= 0 ||
    book.askSize <= 0 ||
    book.bidPrice >= book.askPrice
  ) {
    return "invalid_bbo";
  }
  return undefined;
}

function spreadBpsOf(book: Pick<ExternalTopOfBook, "bidPrice" | "askPrice" | "midPrice">): number {
  return ((book.askPrice - book.bidPrice) / book.midPrice) * 10_000;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) {
    return undefined;
  }
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[mid - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

function weightedAverage(
  sources: readonly FairValueComponent[],
  valueOf: (source: FairValueComponent) => number,
): number {
  return sources.reduce((sum, source) => sum + valueOf(source) * source.weight, 0);
}

function exclusion(
  source: Pick<FairValueExclusion, "venue" | "symbol">,
  reason: FairValueExclusionReason,
): FairValueExclusion {
  return {
    venue: source.venue,
    symbol: source.symbol,
    reason,
  };
}
