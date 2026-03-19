import type { Report } from "../../../../domain/entities/Report.ts";
import type { IReportRepository } from "../../../../domain/ports/IReportRepository.ts";
import { reportsTable } from "../schema.ts";

type PostgresDb = ReturnType<typeof import("../client.ts").createPostgresClient>["db"];

export class PostgresReportRepository implements IReportRepository {
  constructor(private readonly db: PostgresDb) {}

  async save(report: Report): Promise<void> {
    await this.db
      .insert(reportsTable)
      .values({
        id: report.id,
        mode: report.mode,
        venue: report.venue,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        metricsJson: JSON.stringify(report.metrics),
        equityCurveJson: JSON.stringify(report.equityCurve),
        fillAnalysisJson: JSON.stringify(report.fillAnalysis),
      })
      .onConflictDoUpdate({
        target: reportsTable.id,
        set: {
          mode: report.mode,
          venue: report.venue,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          metricsJson: JSON.stringify(report.metrics),
          equityCurveJson: JSON.stringify(report.equityCurve),
          fillAnalysisJson: JSON.stringify(report.fillAnalysis),
        },
      });
  }

  async findAll(): Promise<Report[]> {
    const rows = await this.db.select().from(reportsTable);
    return rows.map((row) => ({
      id: row.id,
      mode: row.mode as Report["mode"],
      venue: row.venue,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      metrics: JSON.parse(row.metricsJson),
      equityCurve: JSON.parse(row.equityCurveJson),
      fillAnalysis: JSON.parse(row.fillAnalysisJson),
    }));
  }
}
