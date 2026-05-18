import {
  EmptyQuoteError,
  QuoteUnavailableError,
  type QuoteEngineError,
} from "../errors/DomainError";
import { StrategyDecision } from "./Strategy";

export function emptyQuoteNoQuoteDecision(
  strategy: string,
  error: QuoteEngineError,
): StrategyDecision | null {
  if (error instanceof QuoteUnavailableError) {
    return StrategyDecision.noQuote({
      cancelExisting: true,
      reasonTags: [error.reasonTag],
      diagnostics: { strategy },
    });
  }

  if (error instanceof EmptyQuoteError) {
    return StrategyDecision.noQuote({
      cancelExisting: true,
      reasonTags: ["empty_quote"],
      diagnostics: { strategy },
    });
  }

  return null;
}
