export interface Position {
  qty: number;
  avgEntry: number;
  unrealizedPnl: number;
}

export const flatPosition: Position = {
  qty: 0,
  avgEntry: 0,
  unrealizedPnl: 0,
};
