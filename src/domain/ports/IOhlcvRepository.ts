export interface OhlcvRecord {
  market: string;
  timeframe: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IOhlcvRepository {
  findByRange(market: string, timeframe: string, from: number, to: number): Promise<OhlcvRecord[]>;
  saveMany(records: OhlcvRecord[]): Promise<void>;
}
