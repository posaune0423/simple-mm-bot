import type { BookUpdate, Level, MarketStats, WsTrade } from "bulk-ts-sdk";

import type {
  BookLevel,
  MarketDataBookSnapshot,
  MarketDataTicker,
  MarketDataTrade,
  RecorderVenue,
} from "../../domain/market-data/MarketDataRecord.ts";

type NormalizeBookSnapshotParams = {
  venue: RecorderVenue;
  symbol: string;
  depth: number;
  receivedAt: number;
  book: BookUpdate;
};

type NormalizeTickerParams = {
  venue: RecorderVenue;
  symbol: string;
  receivedAt: number;
  ticker: MarketStats;
};

type NormalizeTradesParams = {
  venue: RecorderVenue;
  symbol: string;
  receivedAt: number;
  trades: WsTrade[];
};

export function normalizeBulkBookSnapshot(
  params: NormalizeBookSnapshotParams,
): MarketDataBookSnapshot | null {
  const bids = normalizeSide(params.book.levels?.[0] ?? [], "bid", params.depth);
  const asks = normalizeSide(params.book.levels?.[1] ?? [], "ask", params.depth);
  const bestBid = bids[0];
  const bestAsk = asks[0];
  if (bestBid === undefined || bestAsk === undefined) {
    return null;
  }
  if (bestBid.price >= bestAsk.price) {
    return null;
  }
  if (!isFinitePositive(bestBid.price) || !isFinitePositive(bestBid.quantity)) {
    return null;
  }
  if (!isFinitePositive(bestAsk.price) || !isFinitePositive(bestAsk.quantity)) {
    return null;
  }

  const midPrice = (bestBid.price + bestAsk.price) / 2;
  const microPrice =
    (bestAsk.price * bestBid.quantity + bestBid.price * bestAsk.quantity) /
    (bestBid.quantity + bestAsk.quantity);
  const spreadBps = ((bestAsk.price - bestBid.price) / midPrice) * 10_000;

  return {
    id: `${params.venue}:${params.symbol}:book:${params.receivedAt}:${stableBookKey(bids, asks)}`,
    venue: params.venue,
    symbol: params.symbol,
    exchangeTime: timestampToMs(params.book.timestamp),
    receivedAt: params.receivedAt,
    depth: Math.min(params.depth, bids.length, asks.length),
    bestBidPrice: bestBid.price,
    bestBidSize: bestBid.quantity,
    bestAskPrice: bestAsk.price,
    bestAskSize: bestAsk.quantity,
    midPrice,
    microPrice,
    spreadBps,
    bids,
    asks,
    sequence: sequenceOf(params.book),
    raw: params.book,
  };
}

export function normalizeBulkTicker(params: NormalizeTickerParams): MarketDataTicker {
  return {
    id: `${params.venue}:${params.symbol}:ticker:${params.receivedAt}`,
    venue: params.venue,
    symbol: params.symbol,
    exchangeTime: timestampToMs(params.ticker.timestamp),
    receivedAt: params.receivedAt,
    markPrice: finiteNumber(params.ticker.markPrice),
    indexPrice: finiteNumber(params.ticker.oraclePrice),
    lastPrice: finiteNumber(params.ticker.lastPrice),
    fundingRate: finiteNumber(params.ticker.fundingRate),
    openInterest: finiteNumber(params.ticker.openInterest),
    raw: params.ticker,
  };
}

export function normalizeBulkTrades(params: NormalizeTradesParams): MarketDataTrade[] {
  return params.trades.flatMap((trade, index) => {
    if (!isFinitePositive(trade.px) || !isFinitePositive(trade.sz)) {
      return [];
    }
    const exchangeTime = timestampToMs(trade.time);
    const side = trade.side ? "buy" : "sell";
    return [
      {
        id: `${params.venue}:${params.symbol}:trade:${trade.time}:${index}:${trade.px}:${trade.sz}:${side}`,
        venue: params.venue,
        symbol: params.symbol,
        tradeId: `${trade.time}:${index}:${trade.maker}:${trade.taker}`,
        exchangeTime,
        receivedAt: params.receivedAt,
        price: trade.px,
        quantity: trade.sz,
        side,
        aggressorSide: side,
        raw: trade,
      },
    ];
  });
}

function normalizeSide(levels: Level[], side: "bid" | "ask", depth: number): BookLevel[] {
  return levels
    .flatMap((level): BookLevel[] => {
      if (!isFinitePositive(level.px) || !isFinitePositive(level.sz)) {
        return [];
      }
      return [{ price: level.px, quantity: level.sz }];
    })
    .sort((left, right) => (side === "bid" ? right.price - left.price : left.price - right.price))
    .slice(0, depth);
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestampToMs(timestamp: number | undefined): number | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    return undefined;
  }
  return timestamp > 9_999_999_999_999 ? Math.floor(timestamp / 1_000_000) : timestamp;
}

function sequenceOf(book: BookUpdate): string | undefined {
  const record = book as Record<string, unknown>;
  const sequence = record.sequence ?? record.seq;
  return typeof sequence === "string" || typeof sequence === "number"
    ? String(sequence)
    : undefined;
}

function stableBookKey(bids: BookLevel[], asks: BookLevel[]): string {
  const bid = bids[0];
  const ask = asks[0];
  return `${bid?.price ?? "none"}:${bid?.quantity ?? "none"}:${ask?.price ?? "none"}:${ask?.quantity ?? "none"}`;
}
