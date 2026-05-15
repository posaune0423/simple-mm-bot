import { InvalidQuoteError, type QuoteEngineError } from "../errors/DomainError";
import { StrategyDecision } from "./Strategy";

const EMPTY_QUOTE_MESSAGE = "quote must contain at least one bid or ask leg";

export function emptyQuoteNoQuoteDecision(
  strategy: string,
  error: QuoteEngineError,
): StrategyDecision | null {
  if (!(error instanceof InvalidQuoteError) || error.message !== EMPTY_QUOTE_MESSAGE) {
    return null;
  }

  return StrategyDecision.noQuote({
    cancelExisting: true,
    reasonTags: ["empty_quote"],
    diagnostics: { strategy },
  });
}
