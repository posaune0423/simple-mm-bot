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

## 主要コマンド / Primary Commands

```bash
# Bulk beta liveを通常runtimeで起動し、通常shutdownで止める
CONFIG_PATH=config/config.bulk.yml MODE=live bun run src/main.ts

# 最新runを評価
bun run telemetry:evaluate --db data/mmbot.db --output-dir artifacts/telemetry/latest

# Markdown/JSON report生成
bun run telemetry:report --evaluation artifacts/telemetry/latest/evaluation.json --output-dir artifacts/telemetry/latest

# data healthが十分なときだけconfig/config.bulk.ymlを最小変更
bun run telemetry:tune --evaluation artifacts/telemetry/latest/evaluation.json --config config/config.bulk.yml

# code/SDK/design issue化。実作成前はdry-runする
bun run telemetry:issues --evaluation artifacts/telemetry/latest/evaluation.json --report artifacts/telemetry/latest/telemetry-report.md --dry-run=true
```

## ワークフロー / Workflow

1. **Start**
   - `MODE=live`でBulk betaを動かす。
   - telemetry runが`capitalMode: beta_mock`になっていることを確認する。

2. **Telemetry確認**
   - `telemetry:evaluate`を実行する。
   - markout coverageやdata healthが不足している場合はtuningしない。

3. **Evaluate**
   - `telemetry:report`でreportを生成する。
   - data health、PnL、markout、order quality、inventory、runtime healthを見る。

4. **Tuning or Issue**
   - YMLで直す:
     - Net PnLが負、またはPnL per notionalが非正: fill volumeを増やさず、markoutが負でなければ`kappa`を下げてflowを広げる。
     - negative markout/adverse高: `gamma`を上げる。spread wideningが必要なら`kappa`を下げる。
     - fill不足かつmarkout良好: Net PnLとPnL per notionalが正のときだけ`kappa`を上げる。
     - inventory偏り: `kInv`を上げる。
     - drawdown/close cost高: `positionSize`または`budgetUsd`を下げる。
   - issue化する:
     - SDK/APIから必要fieldが取れない。
     - reject/cancel/close失敗がstrategy parameterで説明できない。
     - stale feed、高latency、order lifecycle不整合。
     - Bulk paper/backtest用の市場履歴・execution simulation不足。
     - strategy式、fair price、volatility model自体の改善。

5. **Next Run**
   - 最小YAML変更、またはissue作成後に次のlive runを行う。

## 安全策 / Safety Guardrails

- 最初は短いlive windowで試す。
- `config/config.bulk.yml`の変更は最小にし、次run前にdiffを見る。
- Net PnL、PnL per notional、Markout、runtime healthが良い状態になるまで`budgetUsd`を増やさない。
