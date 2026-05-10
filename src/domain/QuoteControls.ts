export interface QuoteSideControls {
  sizeMultiplier?: number;
  distanceMultiplier?: number;
  disableOpen?: boolean;
  reasonTags?: string[];
}

export interface QuoteControls {
  bid?: QuoteSideControls;
  ask?: QuoteSideControls;
}
