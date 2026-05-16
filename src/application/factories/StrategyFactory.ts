import type { Strategy } from "../../domain/strategies/Strategy";
import {
  FundingAwarePmmStrategy,
  type FundingAwarePmmStrategyConfig,
} from "../../domain/strategies/FundingAwarePmmStrategy";
import {
  SimplePmmStrategy,
  type MarkoutFeedbackGateConfig,
} from "../../domain/strategies/SimplePmmStrategy";
import type { QuoteEngine } from "../../domain/services/QuoteEngine";
import type { AlphaDriftProvider } from "../../domain/ports/IAlphaDriftProvider";

type StrategyFactoryInput = Readonly<
  | {
      kind: "simple_pmm";
      quoteEngine: Pick<QuoteEngine, "compute">;
      markoutFeedbackGate: MarkoutFeedbackGateConfig;
    }
  | {
      kind: "funding_aware_pmm";
      quoteEngine: Pick<QuoteEngine, "compute">;
      markoutFeedbackGate: MarkoutFeedbackGateConfig;
      fundingAware: Omit<FundingAwarePmmStrategyConfig, "markoutFeedbackGate">;
      alphaProvider?: AlphaDriftProvider;
    }
>;

export function buildStrategy(input: StrategyFactoryInput): Strategy {
  if (input.kind === "funding_aware_pmm") {
    return new FundingAwarePmmStrategy(
      input.quoteEngine,
      {
        ...input.fundingAware,
        markoutFeedbackGate: input.markoutFeedbackGate,
      },
      input.alphaProvider,
    );
  }
  return new SimplePmmStrategy(input.quoteEngine, {
    markoutFeedbackGate: input.markoutFeedbackGate,
  });
}
