import type { Report } from "../entities/Report.ts";

export interface IReportRepository {
  save(report: Report): Promise<void>;
  findAll(): Promise<Report[]>;
}
