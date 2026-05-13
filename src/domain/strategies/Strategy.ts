import type { Result } from "neverthrow";
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
    switch (decision.kind) {
      case "quote":
        return handlers.quote(decision);
      case "no_quote":
        return handlers.noQuote(decision);
      default:
        return assertNever(decision);
    }
  },
};

export type StrategyInput = Readonly<{
  snapshot: MarketSnapshot;
  position: PositionSnapshot;
  markoutFeedback: readonly SideMarkoutFeedback[];
  nowMs: number;
}>;

export type StrategyError = StrategyQuoteFailedError | StrategyInputInvalidError;

export abstract class StrategyErrorBase extends Error {
  abstract readonly code: string;

  protected constructor(
    readonly strategy: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export class StrategyQuoteFailedError extends StrategyErrorBase {
  readonly code = "strategy.quote_failed";

  constructor(strategy: string, message: string, options: { cause?: unknown } = {}) {
    super(strategy, message, options);
  }
}

export class StrategyInputInvalidError extends StrategyErrorBase {
  readonly code = "strategy.input_invalid";

  constructor(strategy: string, message: string, options: { cause?: unknown } = {}) {
    super(strategy, message, options);
  }
}

export interface Strategy {
  readonly name: string;
  decide(input: StrategyInput): Result<StrategyDecision, StrategyError>;
}

function assertNever(value: never): never {
  throw new Error(`unreachable strategy decision: ${JSON.stringify(value)}`);
}
