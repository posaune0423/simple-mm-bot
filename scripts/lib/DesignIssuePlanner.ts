export interface DesignIssueInput {
  issueSignals: string[];
  runId: string;
  reportPath: string;
}

export interface PlannedDesignIssue {
  title: string;
  body: string;
  label: string;
}

const issueMap: Record<string, { title: string; label: string; detail: string }> = {
  missing_sdk_fields: {
    title: "Bulk SDK/API field coverage is insufficient for metrics facts",
    label: "metrics-sdk-field-gap",
    detail:
      "Bulk order or fill payloads do not expose fields needed for reliable metrics fact normalization.",
  },
  order_lifecycle_inconsistency: {
    title: "Bulk order lifecycle events need adapter or SDK investigation",
    label: "metrics-runtime-health",
    detail:
      "Reject, cancel, close, or lifecycle state transitions could not be explained by strategy parameters.",
  },
  stale_feed: {
    title: "Bulk market feed freshness or latency needs investigation",
    label: "metrics-runtime-health",
    detail: "Metrics observed stale feed, high latency, or runtime health problems.",
  },
  bulk_backtest_missing: {
    title: "Bulk paper/backtest market history and execution simulation are missing",
    label: "metrics-bulk-backtest",
    detail:
      "Bulk paper/backtest compatibility needs market history and execution simulation before mainnet.",
  },
  strategy_model_gap: {
    title: "Strategy model needs fair price, volatility, or quote formula improvements",
    label: "metrics-strategy-design",
    detail: "Evaluation points to strategy math or model design rather than YAML parameter tuning.",
  },
};

export function planDesignIssues(input: DesignIssueInput): PlannedDesignIssue[] {
  const uniqueSignals = Array.from(new Set(input.issueSignals));
  return uniqueSignals.flatMap((signal) => {
    const issue = issueMap[signal];
    if (issue === undefined) {
      return [];
    }
    return [
      {
        title: issue.title,
        label: issue.label,
        body: [
          issue.detail,
          "",
          `Metrics run: ${input.runId}`,
          `Report: ${input.reportPath}`,
          "",
          `Signal: ${signal}`,
        ].join("\n"),
      },
    ];
  });
}
