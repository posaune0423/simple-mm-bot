import type { Quote, QuoteContext } from "../entities/Quote.ts";

export interface IQuotingStrategy {
  readonly name: string;
  computeQuote(context: QuoteContext): Quote;
}
