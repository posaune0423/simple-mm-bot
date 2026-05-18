import {
  externalMarketSourceKey,
  type ExternalMarketSourceConfig,
  type ExternalMarketTopOfBookRecord,
} from "../../domain/external-market/ExternalMarketTypes.ts";

export type ExternalMarketRealtimeStatsOptions = Readonly<{
  startedAt?: number;
  windowMs?: number;
}>;

export type ExternalMarketRealtimeStatsRow = Readonly<{
  venue: ExternalMarketSourceConfig["venue"];
  symbol: string;
  status: "live" | "waiting";
  ageMs?: number;
  bidPrice?: number;
  askPrice?: number;
  midPrice?: number;
  spreadBps?: number;
  lastPriceChangeAgeMs?: number;
  totalUpdates: number;
  recentUpdates: number;
  totalPriceChanges: number;
  recentPriceChanges: number;
  averageUpdatesPerSecond: number;
  recentUpdatesPerSecond: number;
  averagePriceChangesPerSecond: number;
  recentPriceChangesPerSecond: number;
}>;

export type ExternalMarketRealtimeStatsSnapshot = Readonly<{
  elapsedMs: number;
  windowMs: number;
  totalUpdates: number;
  rows: readonly ExternalMarketRealtimeStatsRow[];
}>;

type SourceStats = {
  readonly source: ExternalMarketSourceConfig;
  latest?: ExternalMarketTopOfBookRecord;
  lastPriceChangeAt?: number;
  totalUpdates: number;
  totalPriceChanges: number;
  recentReceivedAt: number[];
  recentPriceChangedAt: number[];
};

export class ExternalMarketRealtimeStats {
  private readonly startedAt: number;
  private readonly windowMs: number;
  private readonly sourceStats = new Map<string, SourceStats>();

  constructor(
    sources: readonly ExternalMarketSourceConfig[],
    options: ExternalMarketRealtimeStatsOptions = {},
  ) {
    this.startedAt = options.startedAt ?? Date.now();
    this.windowMs = normalizeWindowMs(options.windowMs);
    for (const source of sources) {
      this.sourceStats.set(externalMarketSourceKey(source), {
        source,
        totalUpdates: 0,
        totalPriceChanges: 0,
        recentReceivedAt: [],
        recentPriceChangedAt: [],
      });
    }
  }

  recordTopOfBook(record: ExternalMarketTopOfBookRecord): void {
    const sourceStats = this.sourceStats.get(externalMarketSourceKey(record));
    if (sourceStats === undefined) {
      return;
    }
    const priceChanged =
      sourceStats.latest === undefined ||
      sourceStats.latest.bidPrice !== record.bidPrice ||
      sourceStats.latest.askPrice !== record.askPrice ||
      sourceStats.latest.midPrice !== record.midPrice;
    sourceStats.latest = record;
    sourceStats.totalUpdates += 1;
    sourceStats.recentReceivedAt.push(record.receivedAt);
    if (priceChanged) {
      sourceStats.lastPriceChangeAt = record.receivedAt;
      sourceStats.totalPriceChanges += 1;
      sourceStats.recentPriceChangedAt.push(record.receivedAt);
    }
    this.pruneRecent(sourceStats, record.receivedAt);
  }

  snapshot(nowMs: number = Date.now()): ExternalMarketRealtimeStatsSnapshot {
    const elapsedMs = Math.max(0, nowMs - this.startedAt);
    const rows = [...this.sourceStats.values()].map((sourceStats) =>
      this.rowForSource(sourceStats, nowMs, elapsedMs),
    );

    return {
      elapsedMs,
      windowMs: this.windowMs,
      totalUpdates: rows.reduce((sum, row) => sum + row.totalUpdates, 0),
      rows,
    };
  }

  private rowForSource(
    sourceStats: SourceStats,
    nowMs: number,
    elapsedMs: number,
  ): ExternalMarketRealtimeStatsRow {
    this.pruneRecent(sourceStats, nowMs);
    const averageUpdatesPerSecond =
      elapsedMs > 0 ? sourceStats.totalUpdates / (elapsedMs / 1_000) : 0;
    const averagePriceChangesPerSecond =
      elapsedMs > 0 ? sourceStats.totalPriceChanges / (elapsedMs / 1_000) : 0;
    const recentUpdatesPerSecond = sourceStats.recentReceivedAt.length / (this.windowMs / 1_000);
    const recentPriceChangesPerSecond =
      sourceStats.recentPriceChangedAt.length / (this.windowMs / 1_000);

    if (sourceStats.latest === undefined) {
      return {
        venue: sourceStats.source.venue,
        symbol: sourceStats.source.symbol,
        status: "waiting",
        ageMs: undefined,
        bidPrice: undefined,
        askPrice: undefined,
        midPrice: undefined,
        spreadBps: undefined,
        lastPriceChangeAgeMs: undefined,
        totalUpdates: sourceStats.totalUpdates,
        recentUpdates: sourceStats.recentReceivedAt.length,
        totalPriceChanges: sourceStats.totalPriceChanges,
        recentPriceChanges: sourceStats.recentPriceChangedAt.length,
        averageUpdatesPerSecond,
        recentUpdatesPerSecond,
        averagePriceChangesPerSecond,
        recentPriceChangesPerSecond,
      };
    }

    return {
      venue: sourceStats.source.venue,
      symbol: sourceStats.source.symbol,
      status: "live",
      ageMs: Math.max(0, nowMs - sourceStats.latest.receivedAt),
      bidPrice: sourceStats.latest.bidPrice,
      askPrice: sourceStats.latest.askPrice,
      midPrice: sourceStats.latest.midPrice,
      spreadBps: sourceStats.latest.spreadBps,
      lastPriceChangeAgeMs:
        sourceStats.lastPriceChangeAt === undefined
          ? undefined
          : Math.max(0, nowMs - sourceStats.lastPriceChangeAt),
      totalUpdates: sourceStats.totalUpdates,
      recentUpdates: sourceStats.recentReceivedAt.length,
      totalPriceChanges: sourceStats.totalPriceChanges,
      recentPriceChanges: sourceStats.recentPriceChangedAt.length,
      averageUpdatesPerSecond,
      recentUpdatesPerSecond,
      averagePriceChangesPerSecond,
      recentPriceChangesPerSecond,
    };
  }

  private pruneRecent(sourceStats: SourceStats, nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (
      sourceStats.recentReceivedAt[0] !== undefined &&
      sourceStats.recentReceivedAt[0] < cutoff
    ) {
      sourceStats.recentReceivedAt.shift();
    }
    while (
      sourceStats.recentPriceChangedAt[0] !== undefined &&
      sourceStats.recentPriceChangedAt[0] < cutoff
    ) {
      sourceStats.recentPriceChangedAt.shift();
    }
  }
}

function normalizeWindowMs(windowMs: number | undefined): number {
  if (windowMs === undefined) {
    return 5_000;
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`ExternalMarketRealtimeStats windowMs must be positive: ${windowMs}`);
  }
  return windowMs;
}
