import type {
  ExternalMarketTickerRecord,
  ExternalMarketTopOfBookRecord,
  ExternalMarketTradeRecord,
} from "../external-market/ExternalMarketTypes.ts";

export interface IExternalMarketRepository {
  insertTopOfBook(rows: ExternalMarketTopOfBookRecord[]): Promise<void>;
  insertTickers(rows: ExternalMarketTickerRecord[]): Promise<void>;
  insertTrades(rows: ExternalMarketTradeRecord[]): Promise<void>;
}
