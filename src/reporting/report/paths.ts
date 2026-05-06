import { join } from "node:path";

export interface ReportPaths {
  root: string;
  dateDir: string;
  chartsDir: string;
  reportMd: string;
  latestMd: string;
}

export function reportPaths(rootDir: string, snapshotDate: string): ReportPaths {
  const dateDir = join(rootDir, snapshotDate);
  return {
    root: rootDir,
    dateDir,
    chartsDir: join(dateDir, "charts"),
    reportMd: join(dateDir, "report.md"),
    latestMd: join(rootDir, "latest.md"),
  };
}

export function snapshotDateFromMs(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export function chartFilePath(
  rootDir: string,
  snapshotDate: string,
  periodKey: string,
  chartId: string,
): string {
  return join(rootDir, snapshotDate, "charts", periodKey, `${chartId}.svg`);
}

/**
 * Relative path from YYYY-MM-DD/report.md to its charts
 */
export function chartRelativeFromDateReport(periodKey: string, chartId: string): string {
  return `./charts/${periodKey}/${chartId}.svg`;
}

/**
 * Relative path from latest.md to specific date charts
 */
export function chartRelativeFromLatest(
  snapshotDate: string,
  periodKey: string,
  chartId: string,
): string {
  return `./${snapshotDate}/charts/${periodKey}/${chartId}.svg`;
}
