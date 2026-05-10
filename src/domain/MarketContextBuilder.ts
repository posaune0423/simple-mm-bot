import type { MarketSnapshot } from "./ports/IMarketFeed.ts";
import type { MarketContext } from "./MarketContext.ts";

export interface MarketContextBuilderInput {
  snapshot: MarketSnapshot;
  positionQty?: number;
  now?: number;
  externalMid?: number;
  externalUpdatedAt?: number | null;
  externalMomentumBps?: number;
  pythPrice?: number;
  pythConfBps?: number;
  pythUpdatedAt?: number | null;
  bookImbalanceTop?: number;
  bookImbalanceDepth?: number;
  quoteAgeMs?: number;
  volBps?: number;
  volZ?: number;
}

export class MarketContextBuilder {
  build(input: MarketContextBuilderInput): MarketContext {
    const now = input.now ?? Date.now();
    const { snapshot } = input;
    const midPrice = (snapshot.bestBid + snapshot.bestAsk) / 2;
    const bookUpdatedAt = snapshot.bookUpdatedAt ?? snapshot.timestamp;
    const tickerUpdatedAt = snapshot.tickerUpdatedAt ?? snapshot.timestamp;
    const accountUpdatedAt = snapshot.accountUpdatedAt ?? null;
    const positionUpdatedAt = snapshot.positionUpdatedAt ?? accountUpdatedAt;
    const externalUpdatedAt = input.externalUpdatedAt ?? null;
    const externalDiffBps =
      input.externalMid === undefined || midPrice <= 0
        ? undefined
        : ((input.externalMid - midPrice) / midPrice) * 10_000;

    return {
      ...snapshot,
      midPrice,
      bookUpdatedAt,
      tickerUpdatedAt,
      accountUpdatedAt,
      positionUpdatedAt,
      externalUpdatedAt,
      bookAgeMs: ageMs(now, bookUpdatedAt),
      tickerAgeMs: ageMs(now, tickerUpdatedAt),
      accountAgeMs: accountUpdatedAt === null ? null : ageMs(now, accountUpdatedAt),
      positionAgeMs: positionUpdatedAt === null ? null : ageMs(now, positionUpdatedAt),
      externalAgeMs: externalUpdatedAt === null ? null : ageMs(now, externalUpdatedAt),
      localSpreadBps: spreadBps(snapshot.bestBid, snapshot.bestAsk),
      positionQty: input.positionQty ?? snapshot.positionQty ?? 0,
      ...(input.externalMid === undefined ? {} : { externalMid: input.externalMid }),
      ...(externalDiffBps === undefined ? {} : { externalDiffBps }),
      ...(input.externalMomentumBps === undefined
        ? {}
        : { externalMomentumBps: input.externalMomentumBps }),
      ...(input.pythPrice === undefined ? {} : { pythPrice: input.pythPrice }),
      ...(input.pythConfBps === undefined ? {} : { pythConfBps: input.pythConfBps }),
      ...(input.pythUpdatedAt === undefined || input.pythUpdatedAt === null
        ? {}
        : { pythAgeMs: ageMs(now, input.pythUpdatedAt) }),
      ...(input.bookImbalanceTop === undefined ? {} : { bookImbalanceTop: input.bookImbalanceTop }),
      ...(input.bookImbalanceDepth === undefined
        ? {}
        : { bookImbalanceDepth: input.bookImbalanceDepth }),
      ...(input.quoteAgeMs === undefined ? {} : { quoteAgeMs: input.quoteAgeMs }),
      ...(input.volBps === undefined ? {} : { volBps: input.volBps }),
      ...(input.volZ === undefined ? {} : { volZ: input.volZ }),
    };
  }
}

function ageMs(now: number, updatedAt: number): number {
  return Math.max(0, now - updatedAt);
}

function spreadBps(bestBid: number, bestAsk: number): number {
  if (bestBid <= 0) {
    return 0;
  }
  return ((bestAsk - bestBid) / bestBid) * 10_000;
}
