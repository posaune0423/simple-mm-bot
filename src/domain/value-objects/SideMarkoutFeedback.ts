import type { OrderSide } from "../entities/Quote.ts";

export interface MarkoutFeedbackHorizon {
  horizonSec: number;
  sampleCount: number;
  averageMarkoutBps: number | null;
}

export interface SideMarkoutFeedback {
  side: OrderSide;
  horizons: MarkoutFeedbackHorizon[];
}
