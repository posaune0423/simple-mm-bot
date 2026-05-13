import type { AppConfig } from "../../config";
import { AvellanedaStoikovQuoteModel } from "../../domain/quote-models/AvellanedaStoikovQuoteModel";
import type { QuoteModel } from "../../domain/quote-models/QuoteModel";

type QuoteModelConfig = AppConfig["quoteEngine"]["strategy"];

export function buildQuoteModel(quoteModelConfig: QuoteModelConfig): QuoteModel {
  const modelType: string = quoteModelConfig.type;
  if (modelType !== "avellaneda-stoikov") {
    throw new Error(`Unsupported quote model type: ${modelType}`);
  }
  return new AvellanedaStoikovQuoteModel(quoteModelConfig.params);
}
