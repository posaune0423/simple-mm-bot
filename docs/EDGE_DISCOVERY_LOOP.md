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
