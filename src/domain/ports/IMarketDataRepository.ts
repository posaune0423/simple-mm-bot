import type {
  MarketDataBookSnapshot,
  MarketDataTicker,
  MarketDataTrade,
} from "../market-data/MarketDataRecord.ts";

export interface IMarketDataRepository {
  insertBookSnapshots(rows: MarketDataBookSnapshot[]): Promise<void>;
  insertTrades(rows: MarketDataTrade[]): Promise<void>;
  insertTickers(rows: MarketDataTicker[]): Promise<void>;
}
