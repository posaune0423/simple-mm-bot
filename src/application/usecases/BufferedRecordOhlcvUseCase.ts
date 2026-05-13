import type { MarketSnapshot } from "../../domain/ports/IMarketFeed.ts";
import type { MetricsBuffer } from "../services/MetricsRecorder.ts";

interface RecordOhlcvDelegate {
  execute(snapshot: MarketSnapshot): Promise<void>;
}

export class BufferedRecordOhlcvUseCase {
  constructor(
    private readonly delegate: RecordOhlcvDelegate,
    private readonly buffer: MetricsBuffer,
  ) {}

  async execute(snapshot: MarketSnapshot): Promise<void> {
    this.buffer.enqueue({
      type: "ohlcv",
      priority: "normal",
      run: async () => {
        await this.delegate.execute(snapshot);
      },
    });
  }
}
