import type { Result } from "neverthrow";
import type { ModelQuote } from "../value-objects/ModelQuote";
import type { QuoteModelInput } from "../value-objects/QuoteModelInput";

export type QuoteModelError =
  | {
      type: "invalid_quote_model_input";
      model: string;
      reason: string;
    }
  | {
      type: "invalid_model_quote";
      model: string;
      reason: string;
    };

export interface QuoteModel {
  readonly name: string;
  compute(input: QuoteModelInput): Result<ModelQuote, QuoteModelError>;
}
