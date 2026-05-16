import { match } from "ts-pattern";

import { BulkMarketDataRecorderClient } from "../adapters/bulk/BulkMarketDataRecorderClient.ts";
import type { RecorderVenue } from "../domain/market-data/MarketDataRecord.ts";
import type { IMarketDataRecorderClient } from "../domain/ports/IMarketDataRecorderClient.ts";

export function buildRecorderClient(params: {
  venue: RecorderVenue;
  symbol: string;
  depth: number;
}): IMarketDataRecorderClient {
  return match(params.venue)
    .with(
      "bulk",
      () =>
        new BulkMarketDataRecorderClient({
          httpUrl: requireEnv("BULK_HTTP_URL"),
          wsUrl: requireEnv("BULK_WS_URL"),
          symbol: params.symbol,
          depth: params.depth,
        }),
    )
    .with("binance_usdm", "okx_swap", "bybit_linear", (venue) => {
      throw new Error(`Recorder venue not implemented yet: ${venue}`);
    })
    .exhaustive();
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}
