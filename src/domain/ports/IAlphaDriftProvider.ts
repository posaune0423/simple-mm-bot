export type AlphaDriftSnapshot = Readonly<{
  alphaDriftBps: number;
  updatedAtMs?: number;
  stale?: boolean;
  reason?: string;
}>;

export interface AlphaDriftProvider {
  current(nowMs: number): AlphaDriftSnapshot;
}
