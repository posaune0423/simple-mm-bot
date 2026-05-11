import type { IMarketFeed, MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import { logger } from "../../utils/logger.ts";

export type RiskState = "OK" | "PAUSE_QUOTING" | "EMERGENCY_STOP";
export interface RiskDecision {
  state: RiskState;
  reason?: string;
  market: string;
  marginRatio: number | null;
  imrBuffer: number;
  mmrBuffer: number;
  bookAgeMs: number;
  tickerAgeMs: number;
  accountAgeMs: number;
  positionAgeMs: number;
}

const MAX_BOOK_AGE_MS = 750;
const MAX_TICKER_AGE_MS = 1_500;
const MAX_ACCOUNT_AGE_MS = 5_000;
const MAX_POSITION_AGE_MS = 5_000;
const EPOCH_MS_LOWER_BOUND = 1_000_000_000_000;

export class GuardRiskUseCase {
  constructor(
    private readonly marketFeed: IMarketFeed,
    private readonly thresholds: { imrBuffer: number; mmrBuffer: number },
  ) {}

  async execute(): Promise<RiskDecision> {
    const snapshot = await this.marketFeed.getSnapshot();
    const diagnostics = riskDiagnostics(snapshot, this.thresholds);
    const freshnessReason = staleMarketReason(snapshot);
    if (freshnessReason !== null) {
      logger.warn(
        `guard_risk.pause_quoting market=${snapshot.market} reason=${freshnessReason} bookAgeMs=${bookAgeMs(snapshot)} tickerAgeMs=${tickerAgeMs(snapshot)} accountAgeMs=${accountAgeMs(snapshot)} positionAgeMs=${positionAgeMs(snapshot)}`,
      );
      return { ...diagnostics, state: "PAUSE_QUOTING", reason: freshnessReason };
    }

    const marginRatio = snapshot.marginRatio;

    if (marginRatio === null) {
      logger.debug(`guard_risk.ok market=${snapshot.market} marginRatio=null`);
      return { ...diagnostics, state: "OK" };
    }
    if (marginRatio < this.thresholds.mmrBuffer) {
      logger.warn(
        `guard_risk.emergency_stop market=${snapshot.market} marginRatio=${marginRatio} mmrBuffer=${this.thresholds.mmrBuffer}`,
      );
      return { ...diagnostics, state: "EMERGENCY_STOP", reason: "margin_below_mmr" };
    }
    if (marginRatio < this.thresholds.imrBuffer) {
      logger.warn(
        `guard_risk.pause_quoting market=${snapshot.market} marginRatio=${marginRatio} imrBuffer=${this.thresholds.imrBuffer}`,
      );
      return { ...diagnostics, state: "PAUSE_QUOTING", reason: "margin_below_imr" };
    }
    logger.debug(`guard_risk.ok market=${snapshot.market} marginRatio=${marginRatio}`);
    return { ...diagnostics, state: "OK" };
  }
}

function riskDiagnostics(
  snapshot: MarketSnapshot,
  thresholds: { imrBuffer: number; mmrBuffer: number },
): Omit<RiskDecision, "state" | "reason"> {
  return {
    market: snapshot.market,
    marginRatio: snapshot.marginRatio,
    imrBuffer: thresholds.imrBuffer,
    mmrBuffer: thresholds.mmrBuffer,
    bookAgeMs: bookAgeMs(snapshot),
    tickerAgeMs: tickerAgeMs(snapshot),
    accountAgeMs: accountAgeMs(snapshot),
    positionAgeMs: positionAgeMs(snapshot),
  };
}

function staleMarketReason(snapshot: MarketSnapshot): string | null {
  if (snapshot.bestBid <= 0 || snapshot.bestAsk <= 0 || snapshot.bestBid >= snapshot.bestAsk) {
    return "invalid_book";
  }
  if (snapshot.bookUpdatedAt !== undefined && isEpochMs(snapshot.bookUpdatedAt)) {
    if (bookAgeMs(snapshot) > MAX_BOOK_AGE_MS) {
      return "book_stale";
    }
  }
  if (snapshot.tickerUpdatedAt !== undefined && isEpochMs(snapshot.tickerUpdatedAt)) {
    if (tickerAgeMs(snapshot) > MAX_TICKER_AGE_MS) {
      return "ticker_stale";
    }
  }
  if (snapshot.accountUpdatedAt !== undefined && snapshot.accountUpdatedAt !== null) {
    if (accountAgeMs(snapshot) > MAX_ACCOUNT_AGE_MS) {
      return "account_stale";
    }
  }
  if (snapshot.positionUpdatedAt !== undefined && snapshot.positionUpdatedAt !== null) {
    if (positionAgeMs(snapshot) > MAX_POSITION_AGE_MS) {
      return "position_stale";
    }
  }
  return null;
}

function bookAgeMs(snapshot: MarketSnapshot): number {
  return snapshot.bookUpdatedAt === undefined
    ? 0
    : Math.max(0, Date.now() - snapshot.bookUpdatedAt);
}

function tickerAgeMs(snapshot: MarketSnapshot): number {
  return snapshot.tickerUpdatedAt === undefined
    ? 0
    : Math.max(0, Date.now() - snapshot.tickerUpdatedAt);
}

function accountAgeMs(snapshot: MarketSnapshot): number {
  return snapshot.accountUpdatedAt === undefined || snapshot.accountUpdatedAt === null
    ? 0
    : Math.max(0, Date.now() - snapshot.accountUpdatedAt);
}

function positionAgeMs(snapshot: MarketSnapshot): number {
  return snapshot.positionUpdatedAt === undefined || snapshot.positionUpdatedAt === null
    ? 0
    : Math.max(0, Date.now() - snapshot.positionUpdatedAt);
}

function isEpochMs(timestamp: number): boolean {
  return timestamp >= EPOCH_MS_LOWER_BOUND;
}
