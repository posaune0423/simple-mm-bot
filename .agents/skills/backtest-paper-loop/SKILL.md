---
name: backtest-paper-loop
description: バックテストとペーパートレードを実行し、戦略の妥当性を検証する。Run Bulk/legacy backtest and paper validation loops, write results under data/, and summarize verdicts.
---

# バックテスト・ペーパーループ / Backtest Paper Loop

## 主要コマンド / Primary command

```bash
bun run loop:backtest-paper --backtest-config config/config.backtest.yml --paper-config config/config.paper.yml --from <yyyy-mm-dd> --to <yyyy-mm-dd> --paper-duration-min <minutes> --label <label>
```

Defaults:

- DB: `data/mm.db` (`DB_PATH` or `--db` can override).
- Results: `data/strategy-runs/<timestamp>-<label>/` (`--output-dir` can override).
- Use the shared DB by default so `trading_runs` can compare runs. Create a separate DB only for destructive or isolated experiments, and pass `--db data/tmp/<label>.db` explicitly.

## ワークフロー / Workflow

1. **バックテスト優先 / Prefer backtest-first**
   - まずバックテストで検証を行います。構造的な失敗がある場合はペーパーに進む前に停止します。
   - Validate with backtest first. Stop before paper if backtest fails structurally.
   - Backtest must report fill count, fill rate, notional/min, projected volume pace, PnL per volume, 5s/30s/300s markout, adverse selection, side/intent split, and max position.
   - Treat repeated identical results across different configs as a test-design smell. Do not rank variants until run ids and config snapshots prove the backtest actually exercised different parameters.

2. **結果の記録 / Write results**
   - `data/strategy-runs/<timestamp>-<label>/` に出力を保存します。
   - Save outputs under `data/strategy-runs/<timestamp>-<label>/`.

3. **判定の要約 / Summarize verdict**
   - `summary.json` と `report.json` から結果を要約します。
   - Summarize the verdict from `summary.json` and `report.json`.

4. **Live Gap Check**
   - Compare the latest live canary against the selected backtest candidate before proposing bot changes.
   - Required comparison: fill count, fill rate, notional/min, maker ratio, cancel-before-fill rate, average order live time, quote distance to best, PnL bps, and 5s/30s/300s markout.
   - If backtest is fill-rich but live has 0-4 fills, do not only tune size. First identify whether quotes are too far from touch, ALO orders are cancelled too quickly, feed snapshots are stale, or the backtest fill model is too optimistic.
   - If live has enough fills but worse markout/PnL than backtest, prioritize side-specific `QuoteControls` and quality gate behavior over volume expansion.

## 必須分析 / Required Analysis

- **Metric policy**: do not rank candidates by summed markout. Use bps-normalized average/VW markout, notional-weighted net EV, 30s p10/p5/p1/worst tail, coverage, and side/intent/level/quote-age buckets. Missing funding/reward/external context is `unavailable`, not zero.
- **Data health**: fill count and markout coverage by horizon. Block parameter conclusions when fills < 20 or coverage < 80%.
- **PnL-first gate**: net PnL, PnL per volume bps, max drawdown, and fee/rebate impact.
- **Execution quality**: average/VW markout at 5s/30s/300s, 30s p10/p5/p1/worst tail, adverse selection by horizon.
- **Fill sufficiency**: fill rate, notional/min, projected pace vs **50M/15d**. 50M/15d is a floor, not permission to accept negative PnL.
- **Order lifecycle**: reject rate, cancel rate, cancel-before-fill rate, order live time, latency.
- **Maker quality**: maker ratio and TIF. Bulk live maker quotes should use `ALO`; investigate taker leakage before trusting canary PnL.
- **Quote competitiveness**: distance to mid/best and market spread. Low live fills with healthy backtest fills require this diagnosis.
- **Bucket split**: buy/sell, quote/reduce, level, and quote-age buckets (`<250ms`, `250-500ms`, `500-1000ms`, `1000-3000ms`, `3000ms+`) with fill count, notional, VW 5s/30s markout, 30s p5/p1 tail, and net EV bps. Do not hide toxic open-side fills behind reduce-side gains.

## 必須出力 / Required outputs

- `summary.json`
- `report.json`
- `run.md`
- A short live/backtest gap note when a live canary exists for the same candidate family.

## 完了時処理 / Close-out

- 最終判定（Verdict）の報告。
- バックテストとペーパーの両方が完了したかの確認。
- 結果ディレクトリへのリンク。
- 使用 DB が共有 `data/mm.db` か、明示 override かの報告。
- 次に検証すべきパラメータや挙動の提案。
- State verdict, completion status, result directory, DB path, and next steps.
