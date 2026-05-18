export type ExternalSubscriptionParams = Readonly<{
  symbol: string;
  wsUrl: string;
  reconnectDelayMs: number;
}>;
