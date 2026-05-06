---
name: backtest-paper-loop
description: バックテストとペーパートレードを実行し、戦略の妥当性を検証する。Run Hyperliquid backtest and paper validation loops, write artifacts, and summarize verdicts.
---

# バックテスト・ペーパーループ / Backtest Paper Loop

## 主要コマンド / Primary command

```bash
bun run loop:backtest-paper --config <config-path> --from <yyyy-mm-dd> --to <yyyy-mm-dd> --paper-duration-min <minutes> --output-dir <dir>
```

## ワークフロー / Workflow

1. **バックテスト優先 / Prefer backtest-first**
   - まずバックテストで検証を行います。構造的な失敗がある場合はペーパーに進む前に停止します。
   - Validate with backtest first. Stop before paper if backtest fails structurally.

2. **成果物の記録 / Write artifacts**
   - `artifacts/strategy-runs/<timestamp>/` に出力を保存します。
   - Save outputs under `artifacts/strategy-runs/<timestamp>/`.

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
- 成果物ディレクトリへのリンク。
- 次に検証すべきパラメータや挙動の提案。
- State verdict, completion status, link artifacts, and name next steps.
