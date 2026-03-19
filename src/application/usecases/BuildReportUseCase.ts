import { randomUUID } from "node:crypto";

import type { Analytics } from "../../domain/Analytics.ts";
import type { Report } from "../../domain/entities/Report.ts";
import type { IReportRepository } from "../../domain/ports/IReportRepository.ts";
import type { ITradeRepository } from "../../domain/ports/ITradeRepository.ts";

export class BuildReportUseCase {
  constructor(
    private readonly tradeRepository: ITradeRepository,
    private readonly reportRepository: IReportRepository,
    private readonly analytics: Analytics,
    private readonly mode: "live" | "paper" | "backtest",
    private readonly venue: string,
  ) {}

  async execute(periodStart: number, periodEnd: number, quotedCount: number): Promise<Report> {
    const fills = await this.tradeRepository.findByRange(periodStart, periodEnd);
    const analytics = this.analytics.build({ fills, quotedCount });
    const report: Report = {
      id: randomUUID(),
      mode: this.mode,
      venue: this.venue,
      periodStart,
      periodEnd,
      metrics: analytics.metrics,
      equityCurve: analytics.equityCurve,
      fillAnalysis: analytics.fillAnalysis,
    };
    await this.reportRepository.save(report);
    return report;
  }
}
