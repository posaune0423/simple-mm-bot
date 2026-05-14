import type { QuoteEngineStrategyConfig } from "../../config";
import { AvellanedaStoikovQuoteModel } from "../../domain/quote-models/AvellanedaStoikovQuoteModel";
import { FundingAwareQuoteModel } from "../../domain/quote-models/FundingAwareQuoteModel";
import type { QuoteModel } from "../../domain/quote-models/QuoteModel";

type QuoteModelConfig = QuoteEngineStrategyConfig;

export function buildQuoteModel(quoteModelConfig: QuoteModelConfig): QuoteModel {
  const modelType = (quoteModelConfig as { type: string }).type;
  if (modelType === "avellaneda-stoikov") {
    const params = (quoteModelConfig as Extract<QuoteModelConfig, { type: "avellaneda-stoikov" }>)
      .params;
    return new AvellanedaStoikovQuoteModel(params);
  }
  if (modelType === "funding-aware") {
    const params = (quoteModelConfig as Extract<QuoteModelConfig, { type: "funding-aware" }>)
      .params;
    return new FundingAwareQuoteModel({
      gamma: params.gamma,
      kappa: params.kappa,
      kInv: params.kInv,
      funding: {
        spreadWideningBpsPerAbsFundingBps: params.funding.spreadWideningBpsPerAbsFundingBps,
      },
    });
  }
  const unsupported = quoteModelConfig as { type: string };
  throw new Error(`Unsupported quote model type: ${unsupported.type}`);
}
