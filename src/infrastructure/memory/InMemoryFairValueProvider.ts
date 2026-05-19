import type { ExternalMarketFairValueCalculator } from "../../domain/services/ExternalMarketFairValueCalculator.ts";
import type { IExternalMarketTopOfBookReader } from "../../domain/ports/IExternalMarketTopOfBookStore.ts";
import type { IFairValueProvider } from "../../domain/ports/IFairValueProvider.ts";
import type { FairValueSnapshot } from "../../domain/external-market/FairValueTypes.ts";

export class InMemoryFairValueProvider implements IFairValueProvider {
  constructor(
    private readonly reader: IExternalMarketTopOfBookReader,
    private readonly calculator: ExternalMarketFairValueCalculator,
  ) {}

  getLatestFairValue(nowMs: number): FairValueSnapshot {
    return this.calculator.compute(this.reader.readLatest(), nowMs);
  }
}
