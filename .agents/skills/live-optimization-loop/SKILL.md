---
name: live-optimization-loop
description: ライブ環境での定量評価に基づき、botのパラメータ調整と実装改善を繰り返す。Run the bot in Bulk beta live mode, evaluate telemetry, apply minimal YAML tuning, and create issues for code/SDK/design gaps.
---

# Live Optimization Loop

## Objective

Use Bulk beta `live` as the main experiment environment because current funds are daily mock funds.
Telemetry is mode-independent so the same evaluation path can be reused for `live`, `paper`, and `backtest` when Bulk mainnet support is ready.

## Edge Discovery First

Before tuning, read `docs/EDGE_DISCOVERY_LOOP.md` and treat the run as one iteration of the generic edge discovery loop:

```text
Observe -> Hypothesize -> Instrument -> Experiment -> Analyze -> Decide -> Modify -> Repeat
```

The goal is not to make a generic A-S bot look better. The goal is to identify market-specific conditional EV buckets: when a given `side` / `level` / `size` / `timing` choice is positive after fees, rebates, rewards, funding, inventory cost, and tail risk.

Use every KPI below as evidence for or against explicit hypotheses. Do not tune parameters just because a metric is red. First state which hypothesis is being tested, what data is available, what is missing, and whether the evidence is strong enough to justify a bot change.

Every optimization answer must include these sections:

- **Data coverage**: available facts, missing facts, and hypotheses blocked by missing data.
- **Hypotheses tested**: each hypothesis with `signal`, `action`, `expected effect`, `required data`, `bucket evidence`, and verdict.
- **Bucket evidence**: side / level / age / regime / signal buckets, not only all-run averages.
- **Decision**: one of `unavailable`, `insufficient_data`, `negative`, `inconclusive`, `positive_candidate`, or `production_candidate`.
- **Bot change**: classify as "remove bad bucket", "scale good bucket", or "add missing data".
- **New hypotheses**: the next questions created by this run.

If required data is missing, stop before YAML tuning and propose the smallest telemetry/schema/view/logging/API task needed to make the hypothesis testable.

## Key Performance Indicators (PnL-first)

Use these as the "Pass/Fail" criteria during optimization:

- **Net PnL**: **+ $10 or more per day** (To reach $300/month target).
- **PnL per notional**: **> 0** (Do not chase volume when each dollar traded is losing money).
- **Markout (5s / 30s / 300s)**: **> 0 bps**, with 5s ideally **> +0.5 bps**. Negative means you are being picked off/toxic flow.
- **Adverse Selection Rate**: **< 30%** (Ratio of fills with negative price moves).
- **Fill Sufficiency**: at least **20 fills** and **80% markout coverage** before tuning from the run. Fewer fills can explain symptoms but cannot justify size increases.
- **Fill Rate**: diagnostic only until Net PnL and PnL per notional are positive. Low fill rate by itself is not a tuning target, but repeated 0-4 fill canaries are a live competitiveness problem.
- **Volume Floor**: Phase 1 target is **50M USD / 15d**. Treat it as a floor after PnL/markout, not the primary objective.

## Required Evidence Pack

Every live optimization answer must collect and analyze these fields from `metrics:evaluate` / `metrics:report` before proposing bot changes:

- **Metric policy**: never use summed markout as a primary gate. Use bps-normalized average/VW markout, notional-weighted EV, tail loss, horizon coverage, and bucket evidence. Missing funding/reward/external context must be marked `unavailable`, not estimated into zero.
- **Run identity**: run id, mode, venue, market, `capitalMode`, strategy name, git sha/dirty, config snapshot, start/end time.
- **Data health**: fill count, 5s/30s/300s markout coverage, snapshot freshness, raw field coverage. Block tuning when fills or coverage are insufficient.
- **PnL edge**: net PnL, trade PnL, fee/rebate, PnL per volume bps, max drawdown.
- **Execution quality**: 5s/30s/300s average and VW markout, 30s p10/p5/p1/worst tail, adverse selection by horizon, spread capture, realized spread.
- **Order quality**: submitted count, fill rate, reject rate, cancel rate, cancel-before-fill rate, average latency, average order live time.
- **Maker quality**: maker ratio and configured TIF. Bulk quotes should use `ALO`; if maker ratio is low, investigate taker leakage before increasing volume.
- **Quote competitiveness**: average quote distance to mid and best, market spread, stale rate. Repeated 0-fill runs require this diagnosis before changing size.
- **Side/intent split**: buy vs sell and quote vs reduce fill count, notional, PnL, markout, and adverse selection. Disable or widen only the toxic open side; keep reduce-only side available.
- **Inventory/risk**: average and max absolute position, position skew, reduce/hard-reduce count, minimum margin ratio, close cost, risk guard hits, shutdown close success.
- **Volume pace**: current notional, projected pace vs **50M/15d**, required multiplier, and whether the run is below the floor. Report 150M/14d only as a rebate-tier reference, not as the default optimization target.
- **Live/backtest gap**: compare live canary fill count, fill rate, and notional/min against the latest backtest candidate. If backtest is fill-rich but live has 0-4 fills, treat the fill model or quote competitiveness as the likely gap.

## Decision Order

Apply decisions in this order:

1. **Hypothesis framing first**: name the signal/action/expected-effect pair being tested. If there is no explicit hypothesis, do not tune.
2. **Data health next**: if fill count, markout coverage, or required context coverage is low, do not tune size/budget from the run. Extend the canary or fix telemetry/competitiveness diagnostics.
3. **PnL and markout**: do not increase volume while net PnL, PnL per volume, or multi-horizon markout is negative.
4. **Maker and lifecycle quality**: fix low maker ratio, high cancel churn, short order lifetime, rejects, stale feed, or high latency before strategy parameter tuning.
5. **Bucket-specific controls**: if a side/level/age/regime bucket is toxic, widen/size-down/disable that open bucket through `QuoteControls`; do not disable reduce-only inventory reduction.
6. **Fill sufficiency**: when PnL/markout are healthy but fills are too low, move the inner ALO level closer or increase `kappa` conservatively, then rerun a canary.
7. **Volume floor last**: only after the above pass, check whether projected pace clears 50M/15d. If it does not, improve fill competitiveness without sacrificing markout/PnL.

## Primary Commands

```bash
# Run Bulk beta live directly. Stop with the normal shutdown path after the chosen window.
bun run start

# Evaluate the latest telemetry run.
bun run metrics:evaluate --db data/mm.db --output-dir data/metrics/latest

# Generate human-readable and JSON reports.
bun run metrics:report --evaluation data/metrics/latest/evaluation.json --output-dir data/metrics/latest

# Apply minimal YAML tuning only when data health allows it.
bun run metrics:tune --evaluation data/metrics/latest/evaluation.json --config config/config.bulk.beta.yml

# Create code/SDK/design issues. Use --dry-run=true before creating GitHub issues.
bun run metrics:issues --evaluation data/metrics/latest/evaluation.json --report data/metrics/latest/metrics-report.md --output data/metrics/latest/issues.json --dry-run=true
```

## Data Policy

- Use shared SQLite `data/mm.db` by default for live / paper / backtest telemetry.
- Do not create a DB per run by default. `trading_runs.id` separates runs and keeps multi-run analysis possible.
- Use a separate DB only for destructive, reproducible, or isolated experiments with an explicit `--db data/tmp/<label>.db`.
- Store evaluation results under `data/metrics/<run_id>/` or `data/metrics/latest/`. Do not write optimization results under `artifacts/`.

## Workflow

1. **Start**
   - Read `docs/EDGE_DISCOVERY_LOOP.md`.
   - Choose the hypothesis or data gap for this run. Bulk/Pyth/reward/funding signals are examples, not fixed answers.
   - Run Bulk beta as `MODE=live`.
   - Confirm the telemetry run has `capitalMode: beta_mock`.

2. **Telemetry Check**
   - Run `metrics:evaluate`.
   - Do not tune when markout coverage or data health is insufficient.
   - Mark unavailable hypotheses as `unavailable` instead of inferring from missing signals.

3. **Evaluate**
   - Generate the telemetry report.
   - Review the full Required Evidence Pack: data health, PnL, multi-horizon markout, order quality, maker quality, quote competitiveness, side/intent split, inventory, volume pace, and runtime health.
   - Convert the report into bucket evidence. At minimum, inspect side, intent, level, quote-age (`<250ms`, `250-500ms`, `500-1000ms`, `1000-3000ms`, `3000ms+`), and market freshness buckets when the raw data exists. Each bucket needs fill count, notional, VW 5s/30s markout, 30s p5/p1 tail, and net EV bps.

4. **Tweak or Issue**
   - Only tune when the hypothesis verdict is `positive_candidate` or `production_candidate`.
   - YAML tuning only:
     - Negative Net PnL or non-positive PnL per notional: do not increase fill volume; widen flow by reducing `kappa` unless markout is already negative.
     - Negative markout or high adverse selection: increase `gamma`, widen/size-down the toxic side with `QuoteControls`, or reduce `kappa` if spread widening is needed.
     - Low fills with good markout: improve quote competitiveness only after Net PnL, PnL per notional, maker ratio, and lifecycle metrics are acceptable.
     - Inventory skew: increase `kInv`.
     - High drawdown or close cost: reduce `positionSize` or `budgetUsd`.
   - Create issues instead of editing code when SDK/API fields are missing, lifecycle errors are unexplained, feeds are stale, live/backtest fill gaps are unexplained, Bulk backtest simulation is missing, or strategy math needs design work.
   - If the verdict is `unavailable`, create the smallest telemetry/schema/view/logging/API issue needed to collect the missing data.
   - If the verdict is `insufficient_data` or `inconclusive`, specify the next canary window, sample requirement, and confounder to isolate.

5. **Next Run**
   - Re-run live after the minimal YAML change or after the owning issue is created.
   - Carry forward the new hypotheses generated by this run.

## Safety Guardrails

- Start with short live windows.
- Keep `config/config.bulk.beta.yml` tuning minimal and review the diff before the next run.
- Do not increase `budgetUsd` unless Net PnL, PnL per notional, markout, and runtime health are acceptable.
- Do not mix pure trading EV and reward-adjusted EV. Report both separately when reward/rebate/funding estimates are involved.
