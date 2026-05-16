# Edge Discovery Loop

この文書は、market making bot を「汎用実装」から「市場固有の正EV bucketだけを残すbot」へ育てるための仮説検証ループを定義する。

ここでいうエッジは、機能そのものではない。エッジとは、特定の市場状態で、特定の `side` / `level` / `size` / `timing` の quote を出したときに、fee、rebate、reward、funding、inventory cost、tail risk を含めた条件付きEVがプラスになることを指す。

外部価格、markout、stale cancel、inventory skew、reward推定、funding推定は道具であり、それ自体はエッジではない。これらの道具を使って「どの条件ではquoteするべきで、どの条件ではquoteしないべきか」を特定することがエッジ探索である。

## Loop

すべての改善は次の順序で扱う。

```text
Observe -> Hypothesize -> Instrument -> Experiment -> Analyze -> Decide -> Modify -> Repeat
```

| Step        | Purpose                                                                 | Output                             |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Observe     | live / paper / backtest の raw fact から負け筋や未説明の挙動を見つける  | 観測事実、異常、未説明bucket       |
| Hypothesize | 「どのsignalが、どのactionのEVを変えるか」を仮説化する                  | 検証可能な仮説                     |
| Instrument  | 検証に必要なdata coverageを確認し、不足分を計測タスク化する             | required data / missing data       |
| Experiment  | 小さいriskで同じ条件を再現し、raw factを保存する                        | run id、config snapshot、fact rows |
| Analyze     | side / level / bucket別に markout、PnL、reward-adjusted EV、tail を見る | bucket table、coverage、confidence |
| Decide      | 採用、棄却、保留、追加計測のいずれかに分類する                          | verdict、理由、次action            |
| Modify      | 悪いbucketを消す、良いbucketを拡大する、または計測を増やす              | 最小bot変更またはissue             |
| Repeat      | 新しい結果から次の仮説を作る                                            | next hypotheses                    |

## Hypothesis Format

仮説は必ず次の形で書く。

```text
Hypothesis:
  signal:
  action:
  expected effect:
  required data:
  bucket table:
  decision rule:
  next hypothesis:
```

- `signal`: quote判断に使う観測値。例: externalDiffBps、quoteAgeMs、level、volZ、pythConfBps。
- `action`: quote制御。例: askを止める、bid level1を広げる、sizeを0.5xにする、reduce-onlyだけ残す。
- `expected effect`: 期待する改善。例: 5s markout改善、tail loss低下、reward-adjusted EV改善。
- `required data`: 検証に必要な raw fact と context。
- `bucket table`: signalをbucket化した集計表。
- `decision rule`: どの条件なら採用/棄却/追加計測にするか。
- `next hypothesis`: 結果から自然に出る次の問い。

よい仮説は「market makingが良くなるはず」ではなく、次のように書く。

```text
Hypothesis:
  signal: quoteAgeMs
  action: quoteAgeMs > 1000 のopen quoteをcancelする
  expected effect: 5s/30s markoutのtail lossが下がる
  required data: quote creation time, submitted order, fill time, side, level, fill price, future mid/mark
  bucket table: quoteAgeMs bucket x side x level
  decision rule: >1000ms bucketのnet EVが負で、cancel後のfill lossがvolume/reward損失より小さいならpositive_candidate
  next hypothesis: stale quoteは全side共通か、external move時だけ悪化するか
```

## Data Policy

できる限り raw fact を保存し、評価は後から view、query、script、report で行う。集計済みの結論だけを保存すると、後でbucketを切り直せない。

最低限、次のfactカテゴリを分けて保存する。

| Fact category     | Purpose                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| Market snapshots  | mid、micro、mark、spread、depth、volatility、snapshot freshness        |
| Quote decisions   | quote生成時のside、level、price、size、reason tag、context             |
| Submitted orders  | 実際にvenueへ送ったorder、client id、TIF、status、reject reason        |
| Order lifecycle   | create、ack、replace、cancel、cancel ack、unknown state、resting time  |
| Fills             | fill price、qty、side、maker/taker、fee/rebate、linked order           |
| Fill context      | fill時点のquote context、market context、external signal、quote age    |
| Account state     | position、equity、margin、realized/unrealized PnL、inventory skew      |
| Runtime health    | feed staleness、component freshness、loop latency、error、pause/resume |
| External signals  | external mid、oracle price、confidence、funding、reward inputs         |
| Cost observations | fee tier、maker rebate、reward estimate、funding payment、close cost   |

fillだけを見ても、なぜそのfillを受けたのかは分からない。quote生成時、注文送信時、fill時点のcontextをつなげて保存する。

データが欠けている仮説は結論しない。`unavailable` として、まず計測追加、schema/view追加、logging追加、またはSDK/API調査に落とす。

## Decision Labels

すべての仮説は次のいずれかで終える。

| Label                  | Meaning                                 | Allowed next action             |
| ---------------------- | --------------------------------------- | ------------------------------- |
| `unavailable`          | 必要データがない                        | 計測追加、view追加、SDK/API調査 |
| `insufficient_data`    | データはあるがsample/coverageが足りない | canary延長、小サイズ再実験      |
| `negative`             | 仮説と逆、またはEV改善がない            | 棄却、別bucketへ分解            |
| `inconclusive`         | 方向は見えるがconfounderが強い          | 条件を絞った再実験              |
| `positive_candidate`   | 条件付きEV改善が見える                  | 小サイズlive再検証              |
| `production_candidate` | 複数runで再現し、riskと運用条件を満たす | 最小bot変更、monitor追加        |

`positive_candidate` は即採用ではない。小さいsize、短いwindow、明示した合格条件で live 再検証する。

## Analysis Rules

- sample不足のbucketでsizeを上げない。
- markout coverageが低いrunでquote制御を決めない。
- paper/backtestとliveのfill quality差を無視しない。
- reward込みEVと純PnLを混ぜない。必ず `pure trading EV` と `reward-adjusted EV` を分ける。
- fee/rebate/funding/rewardは、どの時点で確定し、どの時点では推定なのかを分ける。
- side別、level別、intent別、age別、regime別に見る。全体平均だけで判断しない。
- quoteを止める判断では、回避したtail lossと失ったvolume/rewardを両方見る。
- reduce-onlyやrisk-reduction quoteを、open quoteの毒性と同じ理由で止めない。

## Bot Change Classes

bot変更は次の3種類に分類する。

1. 悪いbucketを消す
   - 例: external move時のaskを止める、古いlevel1をcancelする、vol spike時にtight levelを消す。
2. 良いbucketだけsizeを上げる
   - 例: level3だけnet EVが正ならlevel1/2を薄くし、level3を厚くする。
3. 必要データを増やす
   - 例: fill context、external signal、runtime health、reward estimate、funding observationを追加する。

どの変更も、次runで見る合格条件を先に書く。

## Generic Bucket Tables

### Side / level EV

| side | level | fill_count | avg_markout_5s | avg_markout_30s | net_ev_bps | verdict |
| ---- | ----- | ---------: | -------------: | --------------: | ---------: | ------- |
| buy  | 1     |          ? |              ? |               ? |          ? | ?       |
| sell | 1     |          ? |              ? |               ? |          ? | ?       |

### Quote age toxicity

| quote_age_ms | fill_count | avg_markout_5s | p5_markout_30s | net_ev_bps | verdict |
| ------------ | ---------: | -------------: | -------------: | ---------: | ------- |
| <300         |          ? |              ? |              ? |          ? | ?       |
| 300-1000     |          ? |              ? |              ? |          ? | ?       |
| 1000-3000    |          ? |              ? |              ? |          ? | ?       |
| >3000        |          ? |              ? |              ? |          ? | ?       |

### External / oracle signal

| signal_bucket     | conf_bucket | bid_markout | ask_markout | fill_count | verdict |
| ----------------- | ----------- | ----------: | ----------: | ---------: | ------- |
| strongly positive | low         |           ? |           ? |          ? | ?       |
| neutral           | low         |           ? |           ? |          ? | ?       |
| strongly negative | high        |           ? |           ? |          ? | ?       |

### Runtime health

| health_bucket       | fill_count | cancel_fail_rate | stale_fill_rate | avg_markout_30s | verdict |
| ------------------- | ---------: | ---------------: | --------------: | --------------: | ------- |
| fresh               |          ? |                ? |               ? |               ? | ?       |
| stale feed          |          ? |                ? |               ? |               ? | ?       |
| unknown order state |          ? |                ? |               ? |               ? | ?       |

## Example: Bulk-Specific Signals

Bulk、Pyth、reward、funding はこのループの具体例であり、固定された答えではない。

- Bulk mark model: current mark、micro、depth-weighted book、external mid、predicted next mark のズレがside別markoutに効くかを見る。
- Pyth confidence: `pythConfBps` が広い時に両sideのtailが悪化するか、特定sideだけ悪化するかを見る。
- Fair ordering / cancel priority: external move検知後のcancelが、stale fill率とtail markoutを改善するかを見る。
- Alpha reward: volumeだけでなく depth、tightness、uptime を含めた reward-adjusted EV を pure trading EV と分けて見る。
- Funding: fundingを払う側/受け取る側のinventoryで、markoutとinventory costが変わるかを見る。

Bulk固有の仮説でも、最後は必ず `side` / `level` / `size` / `timing` の条件付きEVで判定する。

## Observed Regime: Tight Spread Fill Starvation

2026-05-12 の Bulk BTC-USD live run `dce95392-ff9b-42ad-b23a-ffe8758cbb4c` では、JST 夜に market regime が変わり、open quote の fill rate がほぼゼロになる現象を観測した。

観測事実:

| JST window              | market spread | quote distance to best | fill rate |
| ----------------------- | ------------: | ---------------------: | --------: |
| before 2026-05-12 19:13 |    5.8121 bps |                      ? |    23.26% |
| 2026-05-12 19:13-20:13  |    0.0950 bps |             9.4885 bps |     0.09% |
| 2026-05-12 20:13-21:13  |    0.0896 bps |             7.4528 bps |     0.00% |

- market spread が `~0.1 bps` まで縮小した一方、bot の open quote は best から `~7-10 bps` 離れたままだった。
- 直近 200 submitted quote は `buy: 100 / sell: 100` で、fill は 0 だった。
- 同じ run で `2026-05-12 19:25 JST` に long inventory が発生し、sell reduce が遅れて約 `-36.47 USD` の realized loss になった。
- 直近 100 fill の side / intent split では、`buy:quote` の 30s markout が平均 `-11.6235 bps`、300s markout が平均 `-15.3355 bps` と悪化していた。

仮説:

```text
Hypothesis:
  signal: JST hour + market spread bucket + quote distance to best
  action: tight-spread / far-from-touch regime では open quote を縮小、遠ざける、または止める。reduce-only は別制御で残す
  expected effect: no-fill window の無駄な churn と、toxic long inventory の遅延 close loss を減らす
  required data: JST hour, market spread, quote distance to best, submitted order status, fill rate, side/intent, quote age, inventory age, realized/unrealized PnL
  bucket table: JST hour x spread bucket x side x intent x distance-to-best bucket
  decision rule: tight-spread bucket で fill rate が低く、かつ open fill markout/PnL が負なら negative。JST 日中 bucket だけ正なら time-of-day gated positive_candidate
  next hypothesis: current edge は JST 日中または wider-spread regime に偏っているか
```

次回以降は、少なくとも次の bucket で評価する:

- JST hour: `00-06`, `06-12`, `12-18`, `18-24`
- market spread: `<0.25 bps`, `0.25-1 bps`, `1-3 bps`, `>3 bps`
- quote distance to best: `<1 bps`, `1-3 bps`, `3-7 bps`, `>7 bps`
- side / intent: `buy:quote`, `sell:quote`, `buy:reduce`, `sell:reduce`
- inventory age: `<30s`, `30-180s`, `180s+`

設計メモ:

- quote生成の hot path では DB view scan や重い集計を行わない。
- regime判定、side markout feedback、time-of-day別の control は cold path / background updater で計算し、hot path は `SimplePmmStrategy` の side spec 生成で同期的に読むだけにする。
- `QuoteEngine`、`QuoteModel`、`Strategy` は domain の pure logic として保ち、DB、Bulk SDK、timer、logger には依存させない。
- `QuotingCycleService` の hot path budget は、market snapshot取得、position取得、pure quote compute、order reconcile に集中させる。metrics record、quality scan、report用集計は quote生成を待たせない。

## Open Issue: 1000ms+ Quote Age Toxicity

2026-05-15 の Bulk BTC-USD live run `66feb9eb-daff-4273-9ea7-a5c12d8afbc6` では、feed staleness そのものよりも、open quote が `1000ms` を超えて残った後にfillされる bucket が悪化していた。

観測事実:

| metric                 |         value |
| ---------------------- | ------------: |
| fills                  |          `94` |
| markout coverage       |    `5s 97.9%` |
| avg quote age at fill  |      `1268ms` |
| avg gateway latency    |       `248ms` |
| snapshot freshness     |       `217ms` |
| stale rate             |        `0.1%` |
| reconcile p95          |       `734ms` |
| avg 5s markout         | `-0.0972 bps` |
| avg 30s markout        | `-0.3068 bps` |
| avg 300s markout       | `-0.3560 bps` |
| adverse selection rate |       `52.2%` |

Quote-age bucket:

| quote_age_ms | fills |     notional | vw 5s markout | vw 30s markout | verdict            |
| ------------ | ----: | -----------: | ------------: | -------------: | ------------------ |
| `250-500`    |   `4` |  `$4,000.14` | `-0.3945 bps` |  `+0.7111 bps` | sample too small   |
| `500-1000`   |  `22` | `$20,903.30` | `+0.6446 bps` |  `+1.0743 bps` | positive_candidate |
| `1000-3000`  |  `69` | `$65,134.34` | `-0.1583 bps` |  `-0.4482 bps` | negative           |

Interpretation:

- `snapshot freshness` と `stale rate` は致命的ではないため、一次原因は market feed の単純な stale ではない。
- `1000-3000ms` bucket がfillの大半を占め、5s/30s VW markout が負なので、古くなったquoteがpick offされている可能性が高い。
- `500-1000ms` bucket は正なので、quoteを単純に広げるより、`1000ms` を超える前にcancel/replaceする lifecycle 改善を先に検証する。
- Bulk ではcancel orderが優先される前提なので、古いquoteを残すより、少しでも早くcancel/replace requestを出す価値が高い。
- ただし volume / fill rate を守るため、open quoteを一律停止するのではなく、quote age、side、intent、level、external move を組み合わせた bad bucket removal として扱う。

Hypothesis:

```text
Hypothesis:
  signal: quoteAgeMs + side + intent + level + market move since quote
  action: quoteAgeMs が 1000ms に近づいた open quote を優先的に cancel/replace する
  expected effect: 1000-3000ms bucket の fill count と 30s tail loss を下げ、500-1000ms bucket の良いfillは残す
  required data: quote creation time, cancel request time, cancel ack time, fill time, side, intent, level, market move since quote, external mid move if available
  bucket table: quoteAgeMs bucket x side x intent x level x cancel-before-fill state
  decision rule: 1000-3000ms bucket の VW 5s/30s markout と tail が改善し、total notional/min と fill rate が大きく悪化しないなら positive_candidate
  next hypothesis: stale quote toxicity は全side共通か、external move検知後だけ悪化するか
```

Implementation issue:

- `OrderReconciler` の hot path で、age cap 到達前の cancel/replace 判定を優先する。
- cancel/replace は place より先に出し、unknown state fallback の `cancelAll()` には安易に逃げない。
- `maxRestingMs` は venue上の実効寿命ではなく、bot側の cancel request deadline として扱う。
- acceptance criteria は、次のlive canaryで `1000-3000ms` bucket の fill share と 30s VW markout が改善し、同時に notional/min、fill rate、maker ratio が大きく低下しないこと。

## Agent Output Template

agentは探索結果を次の形で残す。

```text
Data coverage:
  available:
  missing:
  blocked hypotheses:

Hypotheses tested:
  - name:
    label:
    evidence:
    decision:

Bucket evidence:
  table:
  sample:
  markout:
  net_ev:
  caveats:

Decision:
  label:
  why:
  minimum next run:

Bot change:
  class:
  change:
  acceptance criteria:

New hypotheses:
  - ...
```

このtemplateを埋められない場合、botを育てる前に計測を育てる。
