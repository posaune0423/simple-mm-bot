import type { AppConfig } from "../config.ts";
import type { IQuotingStrategy } from "../domain/strategy/IQuotingStrategy.ts";
import { AvellanedaStoikovStrategy } from "../domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";

type StrategyConfig = AppConfig["quoteEngine"]["strategy"];

export function buildQuotingStrategy(strategyConfig: StrategyConfig): IQuotingStrategy {
  const strategyType = (strategyConfig as { type: string }).type;
  if (strategyType !== "avellaneda-stoikov") {
    throw new Error(`Unsupported quoting strategy type: ${strategyType}`);
  }
  return new AvellanedaStoikovStrategy(strategyConfig.params);
}
