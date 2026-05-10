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
- **Markout (5s / 30s / 300s)**: **> 0 bps**。5s はできれば **> +0.5 bps**。
- **Adverse Selection Rate**: **< 30%**
- **Fill Sufficiency**: tuning判断には原則 **20 fills以上**、かつ **markout coverage 80%以上** が必要。少数fillは症状説明には使えるが、size増加の根拠にはしない。
- **Fill Rate**: Net PnLとPnL per notionalが正になるまでは診断指標。低fill rateだけではtuning目標にしない。ただし 0-4 fills のcanaryが続く場合はlive競争力の問題として扱う。
- **Volume Floor**: Phase 1 は **50M USD / 15d** を下限にする。PnL/markoutの後に見るfloorであり、主目的にはしない。
- **Maker fee tier / 14d volume**: 150M/14dはrebate tierの参考値として見る。Phase 1の既定目標は50M/15d。

## 必須 Evidence Pack

live最適化の回答では、bot修正案を出す前に必ず以下を `metrics:evaluate` / `metrics:report` から取得・分析する。

- **Run identity**: run id、mode、venue、market、`capitalMode`、strategy name、git sha/dirty、config snapshot、開始/終了時刻。
- **Data health**: fill count、5s/30s/300s markout coverage、snapshot freshness、raw field coverage。fill数やcoverage不足ならtuningしない。
- **PnL edge**: net PnL、trade PnL、fee/rebate、PnL per volume bps、max drawdown。
- **Execution quality**: 5s/30s/300s average/VW markout、30s tail、horizon別 adverse selection、spread capture、realized spread。
- **Order quality**: submit数、fill rate、reject rate、cancel rate、cancel-before-fill rate、平均latency、平均order live time。
- **Maker quality**: maker ratio と設定TIF。Bulk quoteは`ALO`前提。maker ratioが低い場合はvolume増加より先にtaker混入を調べる。
- **Quote competitiveness**: quote distance to mid/best、market spread、stale rate。0-fill runが続く場合はsize変更より先にここを見る。
- **Side/intent split**: buy/sell、quote/reduce別のfill count、notional、PnL、markout、adverse selection。toxicなopen sideだけ止める/広げる/縮める。reduce-only sideは残す。
- **Inventory/risk**: average/max position、position skew、close cost、risk guard hit、shutdown close成功。
- **Volume pace**: current notional、**50M/15d** に対するprojected pace、required multiplier、floor未達かどうか。150M/14dはrebate tier参考値として別に報告する。
- **Live/backtest gap**: live canaryのfill count、fill rate、notional/minを最新backtest候補と比較する。backtestはfill-richなのにliveが0-4 fillsなら、fill modelまたはquote competitivenessのgapを疑う。

## 判断順序

1. **Data health first**: fill数やmarkout coverageが足りないなら、size/budget tuningをしない。canary延長またはtelemetry/competitiveness診断を直す。
2. **PnL and markout next**: net PnL、PnL per volume、multi-horizon markoutが負ならvolumeを増やさない。
3. **Maker and lifecycle quality**: maker ratio低下、cancel churn、短すぎるorder lifetime、reject、stale feed、高latencyをstrategy parameterより先に見る。
4. **Side-specific controls**: 片側だけtoxicなら `QuoteControls` でそのopen sideだけ広げる/縮める/止める。reduce-onlyは止めない。
5. **Fill sufficiency**: PnL/markoutが良いのにfill不足なら、inner ALO levelを近づける、または`kappa`を保守的に上げてcanaryを再実行する。
6. **Volume floor last**: 最後に50M/15d paceを確認する。未達ならmarkout/PnLを壊さずにfill競争力を改善する。

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
   - PnL、fee/rebate、maker/taker比率、50M/15d pace、maker fee tier到達状況を確認する。

2. **要因分析**
   - data health、PnL、markout、order quality、inventory、runtime healthを見る。
   - negative PnLの要因を、fee負け、negative markout、adverse selection、fill不足、live/backtest fill gap、inventory偏り、reject/cancel/close失敗、stale feed、高latencyに分解する。
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
     - negative markout/adverse高: `gamma`を上げる、`QuoteControls`でtoxic sideを広げる/縮める/止める。spread wideningが必要なら`kappa`を下げる。
     - fill不足かつmarkout良好: Net PnL、PnL per notional、maker ratio、order lifecycleが許容範囲のときだけquote competitiveness改善を試す。
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
