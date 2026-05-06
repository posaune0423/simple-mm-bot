---
name: live-optimization-loop
description: ライブ環境での定量評価に基づき、botのパラメータ調整と実装改善を繰り返す。Run the trading bot in live mode, quantitatively evaluate metrics (markout, PnL), and iteratively optimize parameters/logic using scripts/liveOptimizationLoop.ts.
---

# ライブ最適化ループ / Live Optimization Loop

## 概要 / Objective

Leaderboard上位へのランクアップと、月数万円（$200~$500）の安定収益を上げる「C級bot」への昇格を目標とします。
短時間のLiveテストと、Markout（逆選択指標）などの定量データに基づくパラメータ調整を繰り返し、期待値を最大化します。

## 目標指標 (KPIs for C-Class Bot)

最適化の際、以下の数値を「合格ライン」として判断してください。

- **Markout (5s)**: **> +0.5 bps** (正の値を維持。負の場合は「カモ」にされている)
- **Net PnL**: 1日あたり **+ $10 以上** (月間 $300 達成の目安)
- **Fill Rate**: **5% 〜 15%** (低すぎると機会損失、高すぎると逆選択の疑い)
- **Adverse Selection Rate**: **< 30%** (不利な値動きでの約定割合)

## 主要コマンド / Primary Commands

```bash
# 指定した時間ライブ稼働してレポートを生成 (監視機能が内蔵されています)
# Run live for specific minutes. Integrated monitor will log status every 10s.
bun run loop:live --config config/config.bulk.yml --duration-min 10
```

## ワークフロー / Workflow

1. **初期設定 (必須: gamma > 0)**
   - `config/config.bulk.yml` の `gamma`（在庫リスク回避）を必ず **0.1 以上** に設定します。
   - `gamma: 0` はトレンド相場での逆選択リスクが非常に高いため、C級botとしては不適格です。

2. **実行と監視 / Run and Monitor**
   - `loop:live` コマンドを実行。
   - 実行中、10秒おきに `[MONITOR]` ログが出力され、直近10分間の PnL や Markout (bps) を確認できます。

3. **停止と評価 / Stop and Evaluate**
   - 指定時間後に自動停止し、全注文キャンセルとポジションクローズが行われます。
   - 生成された `summary.json` や `run.md` の数値を目標指標と比較します。

4. **調整と繰り返し / Tweak and Iterate**
   - **Markout が負の場合**: 防御不足。`gamma` を上げるか、`baseSpread` を広げます。
   - **約定が全くない場合**: `baseSpread` が広すぎます。少しずつ狭めます。
   - 修正後、再度実行して指標を改善していきます。

## 安全策 / Safety Guardrails

- `duration-min` は最初は 5-10分 から開始し、安定を確認してから伸ばす。
- `budgetUsd` を増やす前に、必ず Markout が正であることを確認する。
