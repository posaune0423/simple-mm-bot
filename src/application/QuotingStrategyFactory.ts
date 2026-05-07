import type { AppConfig } from "../config.ts";
import type { IQuotingStrategy } from "../domain/strategy/IQuotingStrategy.ts";
import { AvellanedaStoikovStrategy } from "../domain/strategy/avellaneda-stoikov/AvellanedaStoikovStrategy.ts";
import { BulkBetaLeaderboardStrategy } from "../domain/strategy/bulk-beta-leaderboard/BulkBetaLeaderboardStrategy.ts";

type StrategyConfig = AppConfig["quoteEngine"]["strategy"];

export function buildQuotingStrategy(strategyConfig: StrategyConfig): IQuotingStrategy {
  switch (strategyConfig.type) {
    case "avellaneda-stoikov":
      return new AvellanedaStoikovStrategy(strategyConfig.params);
    case "bulk-beta-leaderboard":
      return new BulkBetaLeaderboardStrategy(strategyConfig.params);
  }
}
