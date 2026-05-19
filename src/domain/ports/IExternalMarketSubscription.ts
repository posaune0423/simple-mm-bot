import type {
  ExternalMarketTopOfBookRecord,
  ExternalTopOfBookUpdate,
  ExternalVenueId,
} from "../external-market/ExternalMarketTypes.ts";

export type ExternalTopOfBookHandler = (update: ExternalTopOfBookUpdate) => void;
export type ExternalTopOfBookRecordHandler = (record: ExternalMarketTopOfBookRecord) => void;
export type ExternalSubscriptionErrorHandler = (error: unknown) => void;

export interface IExternalMarketSubscription {
  readonly venue: ExternalVenueId;
  readonly symbol: string;
  start(handlers: {
    onTopOfBook: ExternalTopOfBookHandler;
    onRecord?: ExternalTopOfBookRecordHandler;
    onError?: ExternalSubscriptionErrorHandler;
  }): void;
  stop(): void | Promise<void>;
}
