import type {
  ExternalTopOfBook,
  ExternalTopOfBookUpdate,
} from "../external-market/ExternalMarketTypes.ts";

export interface IExternalMarketTopOfBookReader {
  readLatest(): readonly (ExternalTopOfBook | undefined)[];
}

export interface IExternalMarketTopOfBookWriter {
  update(update: ExternalTopOfBookUpdate): boolean;
}
