export const theme = {
  colors: {
    text: "#1f2933",
    axis: "#9aa5b1",
    grid: "#e4e7eb",
    primary: "#2563eb",
    positive: "#16a34a",
    negative: "#dc2626",
    drawdown: "#fca5a5",
    buy: "#16a34a",
    sell: "#dc2626",
    fee: "#f97316",
    pnl: "#2563eb",
    scatter: "#2563eb",
    background: "#ffffff",
  },
  font: {
    family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    sizeAxis: 11,
    sizeTitle: 14,
  },
  layout: {
    width: 720,
    height: 280,
    padding: { top: 40, right: 16, bottom: 32, left: 56 },
  },
} as const;
