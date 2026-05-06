import { parse, stringify } from "yaml";

export interface TuneResult {
  changed: boolean;
  content: string;
  actions: string[];
}

interface EvaluationForTuning {
  tuningAllowed: boolean;
  markouts: {
    avg5sBps: number;
    avg30sBps?: number;
    adverseSelectionRate: number;
    tail30sBps?: { p10: number };
    spreadCaptureBps?: number;
  };
  orderQuality: {
    fillRate: number;
    rejectRate?: number;
    cancelRate?: number;
    makerRatio?: number;
    avgLatencyMs?: number;
  };
  pnl: {
    netPnl: number;
    tradePnl?: number;
    fee?: number;
    pnlPerNotional: number;
    maxDrawdown: number;
  };
  inventory: {
    positionSkew: number;
    closeCost: number;
  };
}

type MutableConfig = {
  quoteEngine?: {
    minSpreadBps?: number;
    sizing?: {
      positionSize?: number;
      budgetUsd?: number;
    };
    strategy?: {
      params?: {
        gamma?: number;
        kappa?: number;
        kInv?: number;
      };
    };
  };
};

export function tuneBulkConfigDocument(
  yamlText: string,
  evaluation: EvaluationForTuning,
): TuneResult {
  if (!evaluation.tuningAllowed) {
    return { changed: false, content: yamlText, actions: ["blocked_by_data_health"] };
  }

  const config = parse(yamlText) as MutableConfig;
  const params = config.quoteEngine?.strategy?.params;
  const sizing = config.quoteEngine?.sizing;
  const actions: string[] = [];
  const pnlPositive = evaluation.pnl.netPnl > 0 && evaluation.pnl.pnlPerNotional > 0;

  if (params === undefined) {
    return { changed: false, content: yamlText, actions: ["missing_strategy_params"] };
  }

  if (
    (evaluation.markouts.avg30sBps ?? evaluation.markouts.avg5sBps) < -5 ||
    (evaluation.markouts.tail30sBps?.p10 ?? 0) < -150 ||
    evaluation.markouts.adverseSelectionRate > 0.3
  ) {
    if (config.quoteEngine?.minSpreadBps !== undefined) {
      config.quoteEngine.minSpreadBps = bump(config.quoteEngine.minSpreadBps, 1.2);
      actions.push("increase_min_spread_for_negative_markout");
    } else {
      params.gamma = bump(params.gamma ?? 0.1, 1.2);
      actions.push("increase_gamma_for_negative_markout");
    }
  } else if (!pnlPositive) {
    if (config.quoteEngine?.minSpreadBps !== undefined) {
      config.quoteEngine.minSpreadBps = bump(config.quoteEngine.minSpreadBps, 1.2);
      actions.push("increase_min_spread_for_unprofitable_flow");
    } else {
      params.kappa = bump(params.kappa ?? 1, 0.9);
      actions.push("reduce_kappa_for_unprofitable_flow");
    }
  } else if (
    evaluation.orderQuality.fillRate < 0.05 &&
    (evaluation.markouts.avg30sBps ?? evaluation.markouts.avg5sBps) >= 0
  ) {
    if (config.quoteEngine?.minSpreadBps !== undefined && config.quoteEngine.minSpreadBps > 0) {
      config.quoteEngine.minSpreadBps = bump(config.quoteEngine.minSpreadBps, 0.9);
      actions.push("decrease_min_spread_for_low_fill_good_markout");
    } else {
      params.kappa = bump(params.kappa ?? 1, 1.1);
      actions.push("increase_kappa_for_low_fill_good_markout");
    }
  }

  if (Math.abs(evaluation.inventory.positionSkew) > 0.5) {
    params.kInv = bump(params.kInv ?? 0.1, 1.2);
    actions.push("increase_k_inv_for_inventory_skew");
  }

  if (
    sizing !== undefined &&
    (evaluation.pnl.maxDrawdown > 5 || evaluation.inventory.closeCost > 1)
  ) {
    if (sizing.budgetUsd !== undefined) {
      sizing.budgetUsd = round(sizing.budgetUsd * 0.8);
      actions.push("reduce_budget_for_drawdown");
    } else if (sizing.positionSize !== undefined) {
      sizing.positionSize = round(sizing.positionSize * 0.8);
      actions.push("reduce_position_size_for_drawdown");
    }
  }

  if (actions.length === 0) {
    return { changed: false, content: yamlText, actions: ["no_yaml_tuning_needed"] };
  }

  return {
    changed: true,
    content: stringify(config),
    actions,
  };
}

function bump(value: number, multiplier: number): number {
  return round(value * multiplier);
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
