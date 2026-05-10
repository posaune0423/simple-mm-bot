import { describe, expect, test } from "bun:test";

import { planDesignIssues } from "../../scripts/lib/DesignIssuePlanner.ts";

describe("planDesignIssues", () => {
  test("creates issues only for code, SDK, or design signals", () => {
    const issues = planDesignIssues({
      issueSignals: [
        "low_markout_coverage",
        "missing_sdk_fields",
        "order_lifecycle_inconsistency",
        "stale_feed",
        "strategy_model_gap",
      ],
      runId: "run-1",
      reportPath: "data/metrics/run-1/metrics-report.md",
    });

    expect(issues.map((issue) => issue.label)).toEqual([
      "metrics-sdk-field-gap",
      "metrics-runtime-health",
      "metrics-runtime-health",
      "metrics-strategy-design",
    ]);
    expect(issues[0]?.title).toContain("Bulk SDK/API field coverage");
    expect(issues[0]?.body).toContain("run-1");
    expect(issues[0]?.body).toContain("data/metrics/run-1/metrics-report.md");
  });
});
