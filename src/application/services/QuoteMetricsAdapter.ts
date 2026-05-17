import type {
  QuoteMetricsIntent,
  QuoteMetricsLevel,
  QuoteMetricsRecord,
} from "../../domain/types/QuoteMetrics.ts";
import type { OrderTimeInForce } from "../../domain/types/Order.ts";
import type { Quote } from "../../domain/value-objects/Quote.ts";
import type { QuoteLeg } from "../../domain/value-objects/QuoteLeg.ts";

export function toQuoteMetricsRecord(quote: Quote, policy: OrderTimeInForce): QuoteMetricsRecord {
  const levels = toMetricsLevels(quote);
  const top = levels[0];
  return {
    bid: top?.bid ?? quote.fairPrice,
    ask: top?.ask ?? quote.fairPrice,
    bidSize: top?.bidSize ?? 0,
    askSize: top?.askSize ?? 0,
    bidIntent: top?.bidIntent,
    askIntent: top?.askIntent,
    bidControlReasons: top?.bidControlReasons,
    askControlReasons: top?.askControlReasons,
    levels,
    policy,
    fairPrice: quote.fairPrice,
    sigma: quote.sigma,
    alphaDriftBps: quote.diagnostics.alphaDriftBps,
    fundingRateBps: quote.diagnostics.fundingRateBps,
    expectedFundingBps: quote.diagnostics.expectedFundingBps,
    basisBps: quote.diagnostics.basisBps,
    targetInventoryQty: quote.diagnostics.targetInventoryQty,
    inventoryErrorQty: quote.diagnostics.inventoryErrorQty,
  };
}

function toMetricsLevels(quote: Quote): QuoteMetricsLevel[] {
  const levelIndexes = new Set<number>();
  for (const leg of [...quote.bids, ...quote.asks]) {
    levelIndexes.add(leg.level);
  }

  return [...levelIndexes]
    .sort((a, b) => a - b)
    .map((level): QuoteMetricsLevel => {
      const bid = quote.bids.find((leg) => leg.level === level);
      const ask = quote.asks.find((leg) => leg.level === level);
      return {
        level,
        halfSpreadBps: halfSpreadBps(quote, bid, ask),
        bid: bid?.price ?? quote.fairPrice,
        ask: ask?.price ?? quote.fairPrice,
        bidSize: bid?.size ?? 0,
        askSize: ask?.size ?? 0,
        bidIntent: metricsIntent(bid),
        askIntent: metricsIntent(ask),
        bidControlReasons: bid === undefined ? undefined : [...bid.reasonTags],
        askControlReasons: ask === undefined ? undefined : [...ask.reasonTags],
      };
    });
}

function metricsIntent(leg: QuoteLeg | undefined): QuoteMetricsIntent {
  return leg?.exposureIntent ?? "disabled";
}

function halfSpreadBps(quote: Quote, bid: QuoteLeg | undefined, ask: QuoteLeg | undefined): number {
  if (bid === undefined || ask === undefined || quote.fairPrice <= 0) {
    return 0;
  }
  return ((ask.price - bid.price) / 2 / quote.fairPrice) * 10_000;
}
