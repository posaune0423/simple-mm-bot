import type { Strategy } from "../../domain/strategies/Strategy";
import {
  SimplePmmStrategy,
  type MarkoutFeedbackGateConfig,
} from "../../domain/strategies/SimplePmmStrategy";
import type { QuoteEngine } from "../../domain/services/QuoteEngine";

export type StrategyFactoryInput = Readonly<{
  kind: "simple_pmm";
  quoteEngine: QuoteEngine;
  markoutFeedbackGate: MarkoutFeedbackGateConfig;
}>;

export function buildStrategy(input: StrategyFactoryInput): Strategy {
  return new SimplePmmStrategy(input.quoteEngine, {
    markoutFeedbackGate: input.markoutFeedbackGate,
  });
}
