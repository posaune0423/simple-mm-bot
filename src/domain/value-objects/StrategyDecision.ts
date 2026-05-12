import type { Quote } from "../value-objects/Quote.ts";

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

function assertNever(value: never): never {
  throw new Error(`unreachable strategy decision: ${JSON.stringify(value)}`);
}
