import { match } from "ts-pattern";

import { BulkMarketDataRecorderClient } from "../adapters/bulk/BulkMarketDataRecorderClient.ts";
import type { RecorderVenue } from "../domain/market-data/MarketDataRecord.ts";
import type { IMarketDataRecorderClient } from "../domain/ports/IMarketDataRecorderClient.ts";

export function buildRecorderClient(params: {
  venue: RecorderVenue;
  symbol: string;
  depth: number;
  connections: {
    bulk: {
      httpUrl: string;
      wsUrl: string;
    };
  };
}): IMarketDataRecorderClient {
  return match(params.venue)
    .with(
      "bulk",
      () =>
        new BulkMarketDataRecorderClient({
          httpUrl: params.connections.bulk.httpUrl,
          wsUrl: params.connections.bulk.wsUrl,
          symbol: params.symbol,
          depth: params.depth,
        }),
    )
    .with("binance_usdm", "okx_swap", "bybit_linear", (venue) => {
      throw new Error(`Recorder venue not implemented yet: ${venue}`);
    })
    .exhaustive();
}
