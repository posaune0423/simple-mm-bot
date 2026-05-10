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

2. **結果の記録 / Write results**
   - `data/strategy-runs/<timestamp>-<label>/` に出力を保存します。
   - Save outputs under `data/strategy-runs/<timestamp>-<label>/`.

3. **判定の要約 / Summarize verdict**
   - `summary.json` と `report.json` から結果を要約します。
   - Summarize the verdict from `summary.json` and `report.json`.

## 必須出力 / Required outputs

- `summary.json`
- `report.json`
- `run.md`

## 完了時処理 / Close-out

- 最終判定（Verdict）の報告。
- バックテストとペーパーの両方が完了したかの確認。
- 結果ディレクトリへのリンク。
- 使用 DB が共有 `data/mm.db` か、明示 override かの報告。
- 次に検証すべきパラメータや挙動の提案。
- State verdict, completion status, result directory, DB path, and next steps.
