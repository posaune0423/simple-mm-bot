import { EmptyQuoteError, type QuoteEngineError } from "../errors/DomainError";
import { StrategyDecision } from "./Strategy";

export function emptyQuoteNoQuoteDecision(
  strategy: string,
  error: QuoteEngineError,
): StrategyDecision | null {
  if (!(error instanceof EmptyQuoteError)) {
    return null;
  }

  return StrategyDecision.noQuote({
    cancelExisting: true,
    reasonTags: ["empty_quote"],
    diagnostics: { strategy },
  });
}
