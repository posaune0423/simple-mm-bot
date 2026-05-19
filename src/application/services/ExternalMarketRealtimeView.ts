import type {
  ExternalMarketRealtimeStatsRow,
  ExternalMarketRealtimeStatsSnapshot,
} from "./ExternalMarketRealtimeStats.ts";

export type ExternalMarketRealtimeViewMode = "log" | "tui";

export type ExternalMarketRealtimeFairSummary = Readonly<{
  status: string;
  fairMid?: number;
  fairBid?: number;
  fairAsk?: number;
  maxAgeMs?: number;
  storeVersion?: number;
  excludedCount?: number;
}>;

export function renderExternalMarketRealtimeLog(
  snapshot: ExternalMarketRealtimeStatsSnapshot,
  fairValue?: ExternalMarketRealtimeFairSummary,
): string {
  return JSON.stringify({
    event: "external_market_realtime",
    elapsedMs: snapshot.elapsedMs,
    windowMs: snapshot.windowMs,
    totalUpdates: snapshot.totalUpdates,
    fairValue,
    sources: snapshot.rows.map((row) => ({
      venue: row.venue,
      symbol: row.symbol,
      status: row.status,
      bid: round(row.bidPrice),
      ask: round(row.askPrice),
      mid: round(row.midPrice),
      spreadBps: roundSpreadBps(row.spreadBps),
      ageMs: row.ageMs,
      lastPriceChangeAgeMs: row.lastPriceChangeAgeMs,
      recentHz: round(row.recentUpdatesPerSecond),
      recentPriceHz: round(row.recentPriceChangesPerSecond),
      avgHz: round(row.averageUpdatesPerSecond),
      avgPriceHz: round(row.averagePriceChangesPerSecond),
      totalUpdates: row.totalUpdates,
      totalPriceChanges: row.totalPriceChanges,
    })),
  });
}

export function renderExternalMarketRealtimeTui(
  snapshot: ExternalMarketRealtimeStatsSnapshot,
  fairValue?: ExternalMarketRealtimeFairSummary,
): string {
  const header = [
    "\x1b[2J\x1b[HExternal Market Realtime",
    `elapsed=${formatMs(snapshot.elapsedMs)} window=${formatMs(snapshot.windowMs)} totalUpdates=${snapshot.totalUpdates}`,
    fairValue === undefined
      ? "fair=not_computed"
      : `fair=${fairValue.status} mid=${formatPrice(fairValue.fairMid)} bid=${formatPrice(
          fairValue.fairBid,
        )} ask=${formatPrice(fairValue.fairAsk)} maxAgeMs=${formatOptional(
          fairValue.maxAgeMs,
        )} storeVersion=${fairValue.storeVersion ?? "-"}`,
    "",
    [
      pad("venue", 15),
      pad("symbol", 16),
      pad("status", 8),
      pad("bid", 12),
      pad("ask", 12),
      pad("mid", 12),
      pad("spreadBps", 12),
      pad("ageMs", 8),
      pad("recentHz", 9),
      pad("priceHz", 8),
      pad("avgHz", 8),
      pad("lastPxMs", 8),
      "updates",
    ].join(" "),
    "-".repeat(145),
  ];

  return [...header, ...snapshot.rows.map(renderRow), ""].join("\n");
}

function renderRow(row: ExternalMarketRealtimeStatsRow): string {
  return [
    pad(row.venue, 15),
    pad(row.symbol, 16),
    pad(row.status, 8),
    pad(formatPrice(row.bidPrice), 12),
    pad(formatPrice(row.askPrice), 12),
    pad(formatPrice(row.midPrice), 12),
    pad(formatSpreadBps(row.spreadBps), 12),
    pad(formatOptional(row.ageMs), 8),
    pad(formatHz(row.recentUpdatesPerSecond), 9),
    pad(formatHz(row.recentPriceChangesPerSecond), 8),
    pad(formatHz(row.averageUpdatesPerSecond), 8),
    pad(formatOptional(row.lastPriceChangeAgeMs), 8),
    `${row.totalUpdates}/${row.totalPriceChanges}`,
  ].join(" ");
}

function round(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value * 10_000) / 10_000;
}

function roundSpreadBps(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value * 100_000_000) / 100_000_000;
}

function formatPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(4);
}

function formatOptional(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(0);
}

function formatSpreadBps(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(8);
}

function formatHz(value: number): string {
  return value.toFixed(2);
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function pad(value: string, length: number): string {
  return value.length >= length ? value.slice(0, length) : value.padEnd(length, " ");
}
