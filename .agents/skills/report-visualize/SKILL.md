---
name: report-visualize
description: SQLiteのfillsから主要MM指標 (Equity, Drawdown, Markout, Adverse Selection, Sharpe, Volume等) を集計し、依存ライブラリゼロでSVGを自前生成して docs/reports/latest.md と docs/reports/history/YYYY-MM-DD.md にgit管理可能な形で書き出す。Visualize Market-Making bot KPIs from SQLite into SVG charts under docs/reports for git-tracked review.
---

# Report Visualize

## Objective

Generate a self-contained, git-trackable performance dashboard for the trading bot from `data/mmbot.db`. The report contains 24h and 7d windows side-by-side and is regenerated each run. Past snapshots accumulate under `docs/reports/history/`.

## Primary Command

```bash
bun run report:generate
# or with options
bun run report:generate -- --mode live --venue hyperliquid --period both --output docs/reports
```

## Flags

- `--mode` `live` | `paper` | `backtest` (default: `live`) — informational, recorded in the markdown header.
- `--venue` venue name (e.g. `hyperliquid`, `bulk`). Omit to include all venues.
- `--period` `24h` | `7d` | `both` (default: `both`).
- `--output` output directory (default: `docs/reports`).
- `--db` SQLite path (default: `Bun.env.DB_PATH ?? "data/mmbot.db"`).
- `--now` epoch ms — for deterministic runs/tests; omit in production.

## Outputs

- `docs/reports/latest.md` — overwritten each run, pointing to the latest date's charts.
- `docs/reports/YYYY-MM-DD/report.md` — daily snapshot directory and markdown.
- `docs/reports/YYYY-MM-DD/charts/{24h,7d}/<chart>.svg` — chart images local to each date.

## Charts

| Tier | Chart                             | Periods         |
| ---- | --------------------------------- | --------------- |
| 1    | Equity curve (cumulative net PnL) | 24h, 7d         |
| 1    | Drawdown (underwater)             | 24h, 7d         |
| 1    | Markout 5s histogram              | 24h, 7d         |
| 1    | Markout 30s histogram             | 24h, 7d         |
| 1    | Hourly markout 5s (bps)           | 24h, 7d         |
| 1    | KPI summary table                 | 24h+7d combined |
| 2    | Trade PnL histogram               | 24h, 7d         |
| 2    | Adverse selection rate by hour    | 24h, 7d         |
| 2    | Fill count by hour (buy/sell)     | 24h, 7d         |
| 2    | Fee vs Trade PnL by hour          | 24h, 7d         |
| 3    | Rolling Sharpe (60-fill window)   | 7d              |
| 3    | Market notional volume            | 24h, 7d         |
| 3    | Fill price vs mid (scatter)       | 24h             |

## Workflow

1. **Run**: `bun run report:generate -- --period both`.
2. **Review**: Open `docs/reports/latest.md` in a Markdown previewer with SVG support (GitHub renders inline).
3. **Diff**: `git diff docs/reports/` — text-based SVG keeps diffs readable.
4. **Commit**: Add `docs/reports/latest.md`, `docs/reports/history/<date>.md`, and `docs/reports/charts/**` to a single commit when promoting a snapshot.

## Verification

- `bun test tests/reporting tests/infrastructure/FillsQuery.test.ts` — unit + integration tests pass.
- `bun run check` — typecheck + lint pass without disabling rules.
- `xmllint --noout docs/reports/charts/**/*.svg` — every SVG is well-formed.
- Markdown rendering — scroll through `latest.md` and confirm KPI table + 13+ chart sections appear.

## Operational Notes

- Empty windows (no fills in the period) are rendered as "No data" placeholders rather than failing.
- Determinism: pass `--now <epoch_ms>` to fix the snapshot date for reproducible diffs in CI.
- The script reads the DB read-only (single SELECT per period). It is safe to run while the bot is live.
