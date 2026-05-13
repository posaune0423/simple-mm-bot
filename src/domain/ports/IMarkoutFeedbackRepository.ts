import type { SideMarkoutFeedback } from "../strategies/Strategy.ts";

export interface MarkoutFeedbackQuery {
  market: string;
  lookbackFills: number;
  minFilledAt?: number;
  horizonsSec: number[];
}

export interface IMarkoutFeedbackRepository {
  getRecentSideMarkoutFeedback(query: MarkoutFeedbackQuery): Promise<SideMarkoutFeedback[]>;
}

export type { SideMarkoutFeedback };
