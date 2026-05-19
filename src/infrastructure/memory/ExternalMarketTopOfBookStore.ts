import {
  externalMarketSourceKey,
  type ExternalMarketSourceConfig,
  type ExternalTopOfBook,
  type ExternalTopOfBookUpdate,
} from "../../domain/external-market/ExternalMarketTypes.ts";
import type {
  IExternalMarketTopOfBookReader,
  IExternalMarketTopOfBookWriter,
} from "../../domain/ports/IExternalMarketTopOfBookStore.ts";

export class ExternalMarketTopOfBookStore
  implements IExternalMarketTopOfBookReader, IExternalMarketTopOfBookWriter
{
  private readonly sourceIndex = new Map<string, number>();
  private readonly slots: Array<ExternalTopOfBook | undefined>;
  private version = 0;

  constructor(sources: readonly ExternalMarketSourceConfig[]) {
    this.slots = Array.from<ExternalTopOfBook | undefined>({ length: sources.length }).fill(
      undefined,
    );
    sources.forEach((source, index) => {
      this.sourceIndex.set(externalMarketSourceKey(source), index);
    });
  }

  update(update: ExternalTopOfBookUpdate): boolean {
    const index = this.sourceIndex.get(externalMarketSourceKey(update));
    if (index === undefined || !isValidUpdate(update)) {
      return false;
    }

    const current = this.slots[index];
    if (current !== undefined && current.receivedAt >= update.receivedAt) {
      return false;
    }

    const midPrice = (update.bidPrice + update.askPrice) / 2;
    this.slots[index] = Object.freeze({
      ...update,
      midPrice,
      microPrice:
        (update.bidPrice * update.askSize + update.askPrice * update.bidSize) /
        (update.bidSize + update.askSize),
      spreadBps: ((update.askPrice - update.bidPrice) / midPrice) * 10_000,
    });
    this.version += 1;
    return true;
  }

  readLatest(): readonly (ExternalTopOfBook | undefined)[] {
    return this.slots.slice();
  }

  getLatestTopOfBook(): readonly (ExternalTopOfBook | undefined)[] {
    return this.readLatest();
  }

  getVersion(): number {
    return this.version;
  }
}

function isValidUpdate(update: ExternalTopOfBookUpdate): boolean {
  return (
    Number.isFinite(update.receivedAt) &&
    Number.isFinite(update.bidPrice) &&
    Number.isFinite(update.bidSize) &&
    Number.isFinite(update.askPrice) &&
    Number.isFinite(update.askSize) &&
    update.bidPrice > 0 &&
    update.askPrice > 0 &&
    update.bidSize > 0 &&
    update.askSize > 0 &&
    update.bidPrice < update.askPrice
  );
}
