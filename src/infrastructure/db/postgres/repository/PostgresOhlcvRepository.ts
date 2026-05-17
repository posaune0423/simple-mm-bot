import type { IOhlcvRepository, OhlcvRecord } from "../../../../domain/ports/IOhlcvRepository.ts";

export class PostgresOhlcvRepository implements IOhlcvRepository {
  async findByRange(
    _market: string,
    _timeframe: string,
    _from: number,
    _to: number,
  ): Promise<OhlcvRecord[]> {
    return [];
  }

  async saveMany(_records: OhlcvRecord[]): Promise<void> {}
}
