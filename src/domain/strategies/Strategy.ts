import type { Result } from "neverthrow";
import type { SideMarkoutFeedback } from "../value-objects/SideMarkoutFeedback";
import type { MarketSnapshot } from "../ports/IMarketFeed";
import type { PositionSnapshot } from "../value-objects/PositionSnapshot";
import type { StrategyDecision } from "../value-objects/StrategyDecision";

export type StrategyInput = Readonly<{
  snapshot: MarketSnapshot;
  position: PositionSnapshot;
  markoutFeedback: readonly SideMarkoutFeedback[];
  nowMs: number;
}>;

export type StrategyError =
  | {
      type: "strategy_quote_failed";
      strategy: string;
      reason: string;
    }
  | {
      type: "strategy_input_invalid";
      strategy: string;
      reason: string;
    };

export interface Strategy {
  readonly name: string;
  decide(input: StrategyInput): Result<StrategyDecision, StrategyError>;
}
