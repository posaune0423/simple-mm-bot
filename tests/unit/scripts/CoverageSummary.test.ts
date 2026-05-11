import { describe, expect, test } from "bun:test";

import { formatCoverageSummary, parseLcov } from "../../../scripts/lib/CoverageSummary.ts";

describe("coverage summary generation", () => {
  test("parses LCOV totals and ranks the lowest-covered source files", () => {
    const summary = parseLcov(
      [
        "TN:",
        "SF:/repo/src/fast.ts",
        "FNF:2",
        "FNH:2",
        "LF:10",
        "LH:10",
        "BRF:4",
        "BRH:4",
        "end_of_record",
        "TN:",
        "SF:/repo/src/slow.ts",
        "FNF:4",
        "FNH:1",
        "LF:20",
        "LH:5",
        "BRF:8",
        "BRH:2",
        "end_of_record",
        "TN:",
        "SF:/repo/tests/unit/slow.test.ts",
        "FNF:1",
        "FNH:1",
        "LF:5",
        "LH:5",
        "BRF:0",
        "BRH:0",
        "end_of_record",
      ].join("\n"),
      "/repo",
    );

    expect(summary.totals.lines).toEqual({ covered: 20, total: 35, percent: 57.14285714285714 });
    expect(summary.totals.functions).toEqual({
      covered: 4,
      total: 7,
      percent: 57.14285714285714,
    });
    expect(summary.totals.branches).toEqual({ covered: 6, total: 12, percent: 50 });

    const markdown = formatCoverageSummary(summary);
    expect(markdown).toContain("| Lines     |      20 |    35 |    57.1% |");
    expect(markdown.indexOf("`src/slow.ts`")).toBeLessThan(markdown.indexOf("`src/fast.ts`"));
    expect(markdown).not.toContain("tests/unit/slow.test.ts");
  });
});
