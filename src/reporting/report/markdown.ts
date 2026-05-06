import type { PeriodKpis } from "./kpiTable.ts";
import { renderKpiTable } from "./kpiTable.ts";

export interface ChartReference {
  alt: string;
  relativePath: string;
}

export interface ReportSection {
  title: string;
  charts: ReadonlyArray<ChartReference>;
}

export interface MarkdownReportInput {
  generatedAt: number;
  mode: string;
  venue: string;
  periods: ReadonlyArray<PeriodKpis>;
  sections: ReadonlyArray<ReportSection>;
  notes?: ReadonlyArray<string>;
}

export function renderMarkdownReport(input: MarkdownReportInput): string {
  const lines: string[] = [];
  const isoTime = new Date(input.generatedAt).toISOString();
  lines.push("# Bot Performance Report");
  lines.push("");
  lines.push(`- Generated: \`${isoTime}\``);
  lines.push(`- Mode: \`${input.mode}\``);
  lines.push(`- Venue: \`${input.venue}\``);
  lines.push("");
  lines.push("## KPI Summary");
  lines.push("");
  lines.push(renderKpiTable(input.periods));
  lines.push("");
  for (const section of input.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    for (const chart of section.charts) {
      lines.push(`### ${chart.alt}`);
      lines.push("");
      lines.push(`![${chart.alt}](${chart.relativePath})`);
      lines.push("");
    }
  }
  if (input.notes && input.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of input.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
