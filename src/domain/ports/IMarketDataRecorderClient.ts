import type {
  MarketDataBookSnapshot,
  MarketDataTicker,
  MarketDataTrade,
} from "../market-data/MarketDataRecord.ts";

export type MarketDataRecorderHandlers = {
  onBookSnapshot?: (snapshot: MarketDataBookSnapshot) => void;
  onTrade?: (trade: MarketDataTrade) => void;
  onTicker?: (ticker: MarketDataTicker) => void;
  onError?: (error: unknown) => void;
};

export interface IMarketDataRecorderClient {
  connect(handlers: MarketDataRecorderHandlers): Promise<void>;
  disconnect(): Promise<void>;
}
