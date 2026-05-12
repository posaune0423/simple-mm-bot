import type { BasisPoints } from "./BasisPoints";
import type { Price } from "./Price";
import type { Quantity } from "./Quantity";

export type QuoteModelInput = Readonly<{
  fairPrice: Price;
  volatilitySigma: number;
  quoteSize: Quantity;
  positionQty: number;
  inventoryScale: number;
  timeHorizonSec: number;
  minSpreadBps?: BasisPoints;
}>;
