import { match } from "ts-pattern";
import type { QuoteEngineStrategyConfig } from "../../config";
import { AvellanedaStoikovQuoteModel } from "../../domain/quote-models/AvellanedaStoikovQuoteModel";
import { FundingAwareQuoteModel } from "../../domain/quote-models/FundingAwareQuoteModel";
import type { QuoteModel } from "../../domain/quote-models/QuoteModel";

type QuoteModelConfig = QuoteEngineStrategyConfig;

export function buildQuoteModel(quoteModelConfig: QuoteModelConfig): QuoteModel {
  return match(quoteModelConfig)
    .with({ type: "avellaneda-stoikov" }, ({ params }) => new AvellanedaStoikovQuoteModel(params))
    .with(
      { type: "funding-aware" },
      ({ params }) =>
        new FundingAwareQuoteModel({
          gamma: params.gamma,
          kappa: params.kappa,
          kInv: params.kInv,
          funding: {
            spreadWideningBpsPerAbsFundingBps: params.funding.spreadWideningBpsPerAbsFundingBps,
          },
        }),
    )
    .exhaustive();
}
