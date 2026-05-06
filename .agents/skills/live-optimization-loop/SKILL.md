---
name: live-optimization-loop
description: ライブ環境での定量評価に基づき、botのパラメータ調整と実装改善を繰り返す。Run the bot in Bulk beta live mode, evaluate telemetry, apply minimal YAML tuning, and create issues for code/SDK/design gaps.
---

# Live Optimization Loop

## Objective

Use Bulk beta `live` as the main experiment environment because current funds are daily mock funds.
Telemetry is mode-independent so the same evaluation path can be reused for `live`, `paper`, and `backtest` when Bulk mainnet support is ready.

## Key Performance Indicators (PnL-first)

Use these as the "Pass/Fail" criteria during optimization:

- **Net PnL**: **+ $10 or more per day** (To reach $300/month target).
- **PnL per notional**: **> 0** (Do not chase volume when each dollar traded is losing money).
- **Markout (5s)**: **> +0.5 bps** (Must be positive. Negative means you are being picked off/toxic flow).
- **Adverse Selection Rate**: **< 30%** (Ratio of fills with negative price moves).
- **Fill Rate**: Diagnostic only until Net PnL and PnL per notional are positive. Low fill rate is not a tuning target by itself.

## Primary Commands

```bash
# Run live directly. Stop with the normal shutdown path after the chosen window.
CONFIG_PATH=config/config.bulk.yml MODE=live bun run src/main.ts

# Evaluate the latest telemetry run.
bun run telemetry:evaluate --db data/mmbot.db --output-dir artifacts/telemetry/latest

# Generate human-readable and JSON reports.
bun run telemetry:report --evaluation artifacts/telemetry/latest/evaluation.json --output-dir artifacts/telemetry/latest

# Apply minimal YAML tuning only when data health allows it.
bun run telemetry:tune --evaluation artifacts/telemetry/latest/evaluation.json --config config/config.bulk.yml

# Create code/SDK/design issues. Use --dry-run=true before creating GitHub issues.
bun run telemetry:issues --evaluation artifacts/telemetry/latest/evaluation.json --report artifacts/telemetry/latest/telemetry-report.md --dry-run=true
```

## Workflow

1. **Start**
   - Run Bulk beta as `MODE=live`.
   - Confirm the telemetry run has `capitalMode: beta_mock`.

2. **Telemetry Check**
   - Run `telemetry:evaluate`.
   - Do not tune when markout coverage or data health is insufficient.

3. **Evaluate**
   - Generate the telemetry report.
   - Review data health, PnL, markout, order quality, inventory, and runtime health.

4. **Tweak or Issue**
   - YAML tuning only:
     - Negative Net PnL or non-positive PnL per notional: do not increase fill volume; widen flow by reducing `kappa` unless markout is already negative.
     - Negative markout or high adverse selection: increase `gamma`, or reduce `kappa` if spread widening is needed.
     - Low fills with good markout: increase `kappa` only after Net PnL and PnL per notional are positive.
     - Inventory skew: increase `kInv`.
     - High drawdown or close cost: reduce `positionSize` or `budgetUsd`.
   - Create issues instead of editing code when SDK/API fields are missing, lifecycle errors are unexplained, feeds are stale, Bulk backtest simulation is missing, or strategy math needs design work.

5. **Next Run**
   - Re-run live after the minimal YAML change or after the owning issue is created.

## Safety Guardrails

- Start with short live windows.
- Keep `config/config.bulk.yml` tuning minimal and review the diff before the next run.
- Do not increase `budgetUsd` unless Net PnL, PnL per notional, markout, and runtime health are acceptable.
