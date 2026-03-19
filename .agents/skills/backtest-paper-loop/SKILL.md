---
name: backtest-paper-loop
description: Run Hyperliquid backtest and paper validation loops for this repository, write artifacts, and summarize verdicts. Use when the user asks to run backtests, paper tests, strategy loops, or autonomous validation for this market making bot.
---

# Backtest Paper Loop

## Primary command

```bash
bun run loop:backtest-paper --config <config-path> --from <yyyy-mm-dd> --to <yyyy-mm-dd> --paper-duration-min <minutes> --output-dir <dir>
```

## Workflow

1. Prefer backtest-first validation.
2. If backtest fails structurally, stop before paper unless the user asks otherwise.
3. Write outputs under `artifacts/strategy-runs/<timestamp>/`.
4. Summarize the verdict from `summary.json` and `report.json`.

## Required outputs

- `summary.json`
- `report.json`
- `run.md`

## Close-out

- State the verdict
- State whether backtest and paper both completed
- Link the artifact directory
- Name the next parameter or behavior to inspect
