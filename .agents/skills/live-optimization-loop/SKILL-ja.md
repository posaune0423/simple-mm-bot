---
name: live-optimization-loop
description: ライブ環境での定量評価に基づき、botのパラメータ調整と実装改善を繰り返す。Bulk beta liveを主実験環境として、telemetry評価、最小YAML tuning、code/SDK/design issue化を行う。
---

# ライブ最適化ループ / Live Optimization Loop

## 概要 / Objective

現在のBulk betaは毎日mock資金が付与されるため、runtimeは`live`として扱い、telemetryでは`capitalMode: beta_mock`を明示します。
telemetryはmode非依存で保存し、将来のBulk mainnet後に`paper`/`backtest`へ同じ評価指標を流用します。

## 目標指標 / KPIs (PnL-first)

- **Net PnL**: 1日あたり **+ $10 以上**
- **PnL per notional**: **> 0**。1ドル取引するたびに負ける状態ではvolumeを追わない。
- **Markout (5s)**: **> +0.5 bps**
- **Adverse Selection Rate**: **< 30%**
- **Fill Rate**: Net PnLとPnL per notionalが正になるまでは診断指標。低fill rateだけではtuning目標にしない。
- **Maker fee tier / 14d volume**: 14日volumeが**150M USD以上でmaker fee 0 bps**、**500M USD以上でmaker fee -1 bps**になるため、fee/rebate込みのedgeとtier到達可能性を指標に入れる。

## 主要コマンド / Primary Commands

```bash
# Bulk beta liveを通常runtimeで起動し、通常shutdownで止める
bun run start

# 最新runを評価
bun run metrics:evaluate --db data/mm.db --output-dir data/metrics/latest

# Markdown/JSON report生成
bun run metrics:report --evaluation data/metrics/latest/evaluation.json --output-dir data/metrics/latest

# data healthが十分なときだけconfig/config.bulk.beta.ymlを最小変更
bun run metrics:tune --evaluation data/metrics/latest/evaluation.json --config config/config.bulk.beta.yml

# code/SDK/design issue化。実作成前はdry-runする
bun run metrics:issues --evaluation data/metrics/latest/evaluation.json --report data/metrics/latest/metrics-report.md --output data/metrics/latest/issues.json --dry-run=true
```

## データ方針 / Data Policy

- live / paper / backtest telemetry は既定で共有 SQLite `data/mm.db` を使う。
- runごとにDBを分けない。`trading_runs.id` でrunを分離し、同一DBで複数run比較を可能にする。
- 破壊的検証、再現fixture、既存DBを汚したくない isolated experiment のときだけ `--db data/tmp/<label>.db` を明示する。
- 評価結果は `data/metrics/<run_id>/` または `data/metrics/latest/` に保存する。optimization結果を `artifacts/` に書かない。

## ワークフロー / Workflow

0. **Start**
   - `MODE=live`でBulk betaを動かす。
   - telemetry runが`capitalMode: beta_mock`になっていることを確認する。

1. **Fact Check**
   - `metrics:evaluate`を実行する。
   - `metrics:report`でreportを生成する。
   - markout coverageやdata healthが不足している場合はtuningしない。
   - run id、mode、venue、capitalMode、git sha/dirty、config snapshot、fills/orders/markoutsのcoverageを確認する。
   - PnL、fee/rebate、maker/taker比率、14日volume推定、maker fee tier到達状況を確認する。

2. **要因分析**
   - data health、PnL、markout、order quality、inventory、runtime healthを見る。
   - negative PnLの要因を、fee負け、negative markout、adverse selection、fill不足、inventory偏り、reject/cancel/close失敗、stale feed、高latencyに分解する。
   - maker fee tierが0 bpsまたは-1 bpsに近い場合は、現在のnet edgeとtier到達後のfee-adjusted edgeを分けて評価する。

3. **Market状況確認**
   - top book spread、mid/micro/mark、top depth、imbalance、volatility、stalenessを確認する。
   - spread/volatility regime別に、fill、markout、spread capture、adverse selectionを比較する。
   - 市場が薄い、spreadが狭すぎる、feedが古い、または一時的にtoxic flowが強いだけではないかを確認する。

4. **修正案のPlan**
   - YML tuningで閉じる変更と、code/SDK/design issueにする変更を分ける。
   - 変更前に、どのmetricを改善するための変更か、次runで何を合格条件にするかを書く。
   - maker fee tier到達を狙うvolume増加は、Net PnL、PnL per notional、markout、runtime healthが許容範囲にある場合だけplanに入れる。

5. **Params調整 or Issue作成**
   - YMLで直す:
     - Net PnLが負、またはPnL per notionalが非正: fill volumeを増やさず、markoutが負でなければ`kappa`を下げてflowを広げる。
     - negative markout/adverse高: `gamma`を上げる。spread wideningが必要なら`kappa`を下げる。
     - fill不足かつmarkout良好: Net PnLとPnL per notionalが正のときだけ`kappa`を上げる。
     - fee/rebate込みでedgeが正、かつmaker fee tier到達が現実的: まずrisk上限を維持し、quote qualityを落とさずにfill改善できる最小`kappa`調整だけを検討する。
     - inventory偏り: `kInv`を上げる。
     - drawdown/close cost高: `positionSize`または`budgetUsd`を下げる。
   - issue化する:
     - SDK/APIから必要fieldが取れない。
     - reject/cancel/close失敗がstrategy parameterで説明できない。
     - stale feed、高latency、order lifecycle不整合。
     - Bulk paper/backtest用の市場履歴・execution simulation不足。
     - strategy式、fair price、volatility model自体の改善。

6. **Next Run**
   - 最小YAML変更、またはissue作成後に次のlive runを行う。

## 安全策 / Safety Guardrails

- 最初は短いlive windowで試す。
- `config/config.bulk.beta.yml`の変更は最小にし、次run前にdiffを見る。
- Net PnL、PnL per notional、Markout、runtime healthが良い状態になるまで`budgetUsd`を増やさない。
