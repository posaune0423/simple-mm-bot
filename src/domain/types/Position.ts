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

const floatingPointPositionDustQty = 1e-12;

export function isFlatPositionQty(qty: number): boolean {
  return Math.abs(qty) <= floatingPointPositionDustQty;
}
