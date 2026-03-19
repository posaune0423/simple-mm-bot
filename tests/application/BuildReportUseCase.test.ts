import { describe, expect, test } from "bun:test";

import { Analytics } from "../../src/domain/Analytics.ts";
import { BuildReportUseCase } from "../../src/application/usecases/BuildReportUseCase.ts";

describe("BuildReportUseCase", () => {
  test("builds a report from fills and persists it", async () => {
    const tradeRepository = {
      async save() {},
      async findByRange() {
        return [
          {
            id: "1",
            venue: "paper",
            market: "ETH",
            side: "buy" as const,
            price: 100,
            qty: 1,
            fee: 0.1,
            tradePnl: 1,
            filledAt: 1,
            markPriceAtFill: 100,
            markPrice5s: 99,
            markPrice30s: 98,
          },
        ];
      },
      async findAll() {
        return [];
      },
    };
    const saved: unknown[] = [];
    const reportRepository = {
      async save(report: unknown) {
        saved.push(report);
      },
      async findAll() {
        return [];
      },
    };

    const report = await new BuildReportUseCase(
      tradeRepository,
      reportRepository,
      new Analytics(),
      "paper",
      "hyperliquid",
    ).execute(0, 10, 2);

    expect(saved).toHaveLength(1);
    expect(report.metrics.netPnl).toBeCloseTo(0.9);
    expect(report.fillAnalysis.adverseSelectionCount).toBe(1);
  });
});
