import { describe, expect, test } from "bun:test";
import { parse, stringify } from "yaml";

import { tuneBulkConfigDocument } from "../../../scripts/lib/BulkConfigTuning.ts";

const baseConfig = `
mode: live
venue: bulk
quoteEngine:
  sizing:
    positionSize: 0.01
    budgetUsd: 100
  strategy:
    type: avellaneda-stoikov
    params:
      gamma: 0.1
      kappa: 1
      kInv: 0.1
risk:
  maxPositionQty: 0.05
`;

describe("tuneBulkConfigDocument", () => {
  test("widens quotes by increasing gamma when markout is negative and tuning is allowed", () => {
    const tuned = tuneBulkConfigDocument(baseConfig, {
      tuningAllowed: true,
      markouts: { avg5sBps: -1, adverseSelectionRate: 0.6, spreadCaptureBps: -0.2 },
      orderQuality: {
        fillRate: 0.08,
        rejectRate: 0,
        cancelRate: 0,
        makerRatio: 1,
        avgLatencyMs: 10,
      },
      pnl: { netPnl: -1, tradePnl: -1, fee: 0, pnlPerNotional: -0.001, maxDrawdown: 1 },
      inventory: { positionSkew: 0.2, closeCost: 0 },
    });

    const parsed = parse(tuned.content);
    expect(tuned.changed).toBe(true);
    expect(parsed.quoteEngine.strategy.params.gamma).toBe(0.12);
    expect(parsed.quoteEngine.strategy.params.kappa).toBe(1);
    expect(tuned.actions).toContain("increase_gamma_for_negative_markout");
  });

  test("returns unchanged YAML when data health blocks tuning", () => {
    const current = stringify(parse(baseConfig));
    const tuned = tuneBulkConfigDocument(current, {
      tuningAllowed: false,
      markouts: { avg5sBps: -1, adverseSelectionRate: 0.6, spreadCaptureBps: -0.2 },
      orderQuality: {
        fillRate: 0.08,
        rejectRate: 0,
        cancelRate: 0,
        makerRatio: 1,
        avgLatencyMs: 10,
      },
      pnl: { netPnl: -1, tradePnl: -1, fee: 0, pnlPerNotional: -0.001, maxDrawdown: 1 },
      inventory: { positionSkew: 0.2, closeCost: 0 },
    });

    expect(tuned.changed).toBe(false);
    expect(tuned.content).toBe(current);
    expect(tuned.actions).toEqual(["blocked_by_data_health"]);
  });

  test("widens quotes instead of chasing low fill rate when net PnL is negative", () => {
    const tuned = tuneBulkConfigDocument(baseConfig, {
      tuningAllowed: true,
      markouts: { avg5sBps: 1, adverseSelectionRate: 0.1, spreadCaptureBps: 0.3 },
      orderQuality: {
        fillRate: 0.01,
        rejectRate: 0,
        cancelRate: 0,
        makerRatio: 1,
        avgLatencyMs: 10,
      },
      pnl: { netPnl: -0.5, tradePnl: -0.4, fee: 0.1, pnlPerNotional: -0.0001, maxDrawdown: 1 },
      inventory: { positionSkew: 0.1, closeCost: 0 },
    });

    const parsed = parse(tuned.content);
    expect(tuned.changed).toBe(true);
    expect(parsed.quoteEngine.strategy.params.kappa).toBe(0.9);
    expect(tuned.actions).toContain("reduce_kappa_for_unprofitable_flow");
    expect(tuned.actions).not.toContain("increase_kappa_for_low_fill_good_markout");
  });

  test("raises minimum spread before changing kappa when unprofitable config has a spread floor", () => {
    const tuned = tuneBulkConfigDocument(
      `
mode: live
venue: bulk
quoteEngine:
  minSpreadBps: 6
  sizing:
    positionSize: 0.05
    budgetUsd: 250
  strategy:
    type: avellaneda-stoikov
    params:
      gamma: 0
      kappa: 8
      kInv: 0.05
`,
      {
        tuningAllowed: true,
        markouts: { avg5sBps: 0.6, adverseSelectionRate: 0.1, spreadCaptureBps: 0 },
        orderQuality: {
          fillRate: 0.5,
          rejectRate: 0,
          cancelRate: 0,
          makerRatio: 1,
          avgLatencyMs: 10,
        },
        pnl: {
          netPnl: -3,
          tradePnl: 0,
          fee: 3,
          pnlPerNotional: -0.0001,
          maxDrawdown: 3,
        },
        inventory: { positionSkew: 0, closeCost: 0 },
      },
    );

    const parsed = parse(tuned.content);
    expect(tuned.changed).toBe(true);
    expect(parsed.quoteEngine.minSpreadBps).toBe(7.2);
    expect(parsed.quoteEngine.strategy.params.kappa).toBe(8);
    expect(tuned.actions).toContain("increase_min_spread_for_unprofitable_flow");
  });

  test("raises minimum spread before changing gamma when toxic flow has a spread floor", () => {
    const tuned = tuneBulkConfigDocument(
      `
mode: live
venue: bulk
quoteEngine:
  minSpreadBps: 5.4
  sizing:
    positionSize: 0.05
    budgetUsd: 250
  strategy:
    type: avellaneda-stoikov
    params:
      gamma: 0
      kappa: 8
      kInv: 0.05
`,
      {
        tuningAllowed: true,
        markouts: { avg5sBps: -1.36, adverseSelectionRate: 1, spreadCaptureBps: 0 },
        orderQuality: {
          fillRate: 0.016,
          rejectRate: 0.004,
          cancelRate: 0,
          makerRatio: 0,
          avgLatencyMs: 650,
        },
        pnl: {
          netPnl: 0,
          tradePnl: 0,
          fee: 0,
          pnlPerNotional: 0,
          maxDrawdown: 0,
        },
        inventory: { positionSkew: 0, closeCost: 0 },
      },
    );

    const parsed = parse(tuned.content);
    expect(tuned.changed).toBe(true);
    expect(parsed.quoteEngine.minSpreadBps).toBe(6.48);
    expect(parsed.quoteEngine.strategy.params.gamma).toBe(0);
    expect(tuned.actions).toContain("increase_min_spread_for_negative_markout");
  });

  test("tightens minimum spread before changing kappa when profitable flow has low fills", () => {
    const tuned = tuneBulkConfigDocument(
      `
mode: live
venue: bulk
quoteEngine:
  minSpreadBps: 6
  sizing:
    positionSize: 0.05
    budgetUsd: 250
  strategy:
    type: avellaneda-stoikov
    params:
      gamma: 0
      kappa: 8
      kInv: 0.05
`,
      {
        tuningAllowed: true,
        markouts: { avg5sBps: 2.5, adverseSelectionRate: 0, spreadCaptureBps: 0 },
        orderQuality: {
          fillRate: 0.005,
          rejectRate: 0,
          cancelRate: 0,
          makerRatio: 1,
          avgLatencyMs: 10,
        },
        pnl: {
          netPnl: 0.13,
          tradePnl: 0.23,
          fee: 0.1,
          pnlPerNotional: 0.00013,
          maxDrawdown: 0.03,
        },
        inventory: { positionSkew: 0, closeCost: 0 },
      },
    );

    const parsed = parse(tuned.content);
    expect(tuned.changed).toBe(true);
    expect(parsed.quoteEngine.minSpreadBps).toBe(5.4);
    expect(parsed.quoteEngine.strategy.params.kappa).toBe(8);
    expect(tuned.actions).toContain("decrease_min_spread_for_low_fill_good_markout");
  });
});
