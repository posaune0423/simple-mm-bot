import type { Result } from "neverthrow";
import { match } from "ts-pattern";
import type { StrategyError } from "../errors/DomainError";
import type { MarketSnapshot } from "../ports/IMarketFeed";
import type { PositionSnapshot } from "../value-objects/PositionSnapshot";
import type { Quote } from "../value-objects/Quote";
import type { OrderSide } from "../value-objects/QuoteLeg";

export interface MarkoutFeedbackHorizon {
  horizonSec: number;
  sampleCount: number;
  averageMarkoutBps: number | null;
}

export interface SideMarkoutFeedback {
  side: OrderSide;
  horizons: MarkoutFeedbackHorizon[];
}

export type StrategyDiagnostics = Readonly<{
  strategy: string;
  quoteModel?: string;
}>;

export type StrategyDecision =
  | {
      kind: "quote";
      quote: Quote;
      reasonTags: readonly string[];
      diagnostics: StrategyDiagnostics;
    }
  | {
      kind: "no_quote";
      cancelExisting: boolean;
      reasonTags: readonly string[];
      diagnostics: StrategyDiagnostics;
    };

export const StrategyDecision = {
  quote(input: Omit<Extract<StrategyDecision, { kind: "quote" }>, "kind">): StrategyDecision {
    return {
      kind: "quote",
      ...input,
    };
  },

  noQuote(input: Omit<Extract<StrategyDecision, { kind: "no_quote" }>, "kind">): StrategyDecision {
    return {
      kind: "no_quote",
      ...input,
    };
  },

  match<T>(
    decision: StrategyDecision,
    handlers: {
      quote: (decision: Extract<StrategyDecision, { kind: "quote" }>) => T;
      noQuote: (decision: Extract<StrategyDecision, { kind: "no_quote" }>) => T;
    },
  ): T {
    return match(decision)
      .with({ kind: "quote" }, handlers.quote)
      .with({ kind: "no_quote" }, handlers.noQuote)
      .exhaustive();
  },
};

export type StrategyInput = Readonly<{
  snapshot: MarketSnapshot;
  position: PositionSnapshot;
  markoutFeedback: readonly SideMarkoutFeedback[];
  nowMs: number;
}>;

export interface Strategy {
  readonly name: string;
  decide(input: StrategyInput): Result<StrategyDecision, StrategyError>;
}
