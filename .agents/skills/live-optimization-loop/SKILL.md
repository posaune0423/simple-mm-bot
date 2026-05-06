---
name: live-optimization-loop
description: ライブ環境での定量評価に基づき、botのパラメータ調整と実装改善を繰り返す。Run the trading bot in live mode, quantitatively evaluate metrics (markout, PnL), and iteratively optimize parameters/logic using scripts/liveOptimizationLoop.ts.
---

# Live Optimization Loop

## Objective

Targeting to become a "C-Class Bot" that earns a stable monthly profit ($200-$500) and moves up the Leaderboard.
Iteratively optimize parameters and logic based on quantitative data like Markout (adverse selection metric) through integrated live tests.

## Key Performance Indicators (KPIs for C-Class Bot)

Use these as the "Pass/Fail" criteria during optimization:

- **Markout (5s)**: **> +0.5 bps** (Must be positive. Negative means you are being picked off/toxic flow).
- **Net PnL**: **+ $10 or more per day** (To reach $300/month target).
- **Fill Rate**: **5% to 15%** (Too low = missed opportunity, too high = likely adverse selection).
- **Adverse Selection Rate**: **< 30%** (Ratio of fills with negative price moves).

## Primary Commands

```bash
# Run live for a specific duration. Integrated monitor logs status every 10s.
bun run loop:live --config config/config.bulk.yml --duration-min 10
```

## Workflow

1. **Initial Setup (Mandatory: gamma > 0)**
   - Ensure `gamma` (inventory risk aversion) in `config/config.bulk.yml` is **at least 0.1**.

2. **Run and Monitor**
   - Execute `loop:live`.
   - The integrated monitor will log `[MONITOR]` status every 10s showing recent PnL and Markout (bps).

3. **Auto-stop and Evaluate**
   - The bot stops automatically, cancels orders, and closes positions.
   - Compare `summary.json` or `run.md` against KPIs.

4. **Tweak and Iterate**
   - **If Markout is negative**: Increase `gamma` or widen `baseSpread`.
   - **If no trades**: Narrow `baseSpread` incrementally.
   - Repeat until the bot meets C-Class KPIs.

## Safety Guardrails

- Start with short `duration-min` (5-10 mins).
- Ensure Markout is positive before increasing `budgetUsd`.
