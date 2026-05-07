# Current MM Strategy

この文書は、`simple-mm-bot` の market making strategy を、実装に沿って説明する。

Bulk beta live の current config は `bulk-beta-leaderboard` を使う。Avellaneda-Stoikov は `config/config.paper.yml`、`config/config.bulk.mainnet.yml`、backtest path で引き続き選択できる。
ここでは quote 生成と risk control の流れに絞る。

## 全体像

```mermaid
flowchart LR
  subgraph Market["Bulk Market Feed"]
    Ticker["ticker<br/>markPrice"]
    Book["L2 book<br/>bestBid / bestAsk / microPrice"]
    Account["account<br/>marginRatio"]
  end

  subgraph Domain["Domain quote logic"]
    Fair["FairPriceCalculator<br/>fairPrice"]
    Vol["VolatilityEstimator<br/>sigma"]
    Size["QuoteEngine sizing<br/>quoteSize"]
    AS["Configured strategy<br/>spread + side size multipliers"]
  end

  subgraph Orders["Order refresh"]
    Reconcile["OrderManager<br/>cancel/replace changed orders"]
    Bid["place bid"]
    Ask["place ask"]
  end

  Ticker --> Fair
  Book --> Fair
  Ticker --> Vol
  Account --> AS
  Fair --> AS
  Vol --> AS
  Size --> AS
  AS --> Reconcile --> Bid --> Ask
```

1 tick ごとに `RefreshQuotesUseCase` が market snapshot と現在 position を読み、`QuoteEngine` で bid / ask を作る。
その後、`OrderManager` が既存 quote と新 quote を比較し、価格/サイズ差分が閾値以上の order だけ cancel/replace する。

## 現在の設定

`config/config.bulk.beta.yml` の現在値:

| 項目                    |                  現在値 | 役割                                         |
| ----------------------- | ----------------------: | -------------------------------------------- |
| `market`                |               `BTC-USD` | quote 対象 market                            |
| `environment`           |                  `beta` | mock-capital Bulk environment                |
| `intervalMs`            |                  `1000` | tick 間隔                                    |
| `markWeight`            |                  `0.25` | mark price と micro price の混合比           |
| `inventoryScale`        |                  `0.08` | inventory skew の正規化幅                    |
| `timeHorizonSec`        |                    `10` | spread / skew が見る短期 horizon             |
| `slideMarginThreshold`  |                  `0.06` | margin ratio が低いとき IOC に切り替える閾値 |
| `defaultTimeInForce`    |                   `GTC` | 通常 quote の time in force                  |
| `positionSize`          |                  `1.25` | 片側 quote の最大 base size                  |
| `budgetUsd`             |                  `9600` | 片側 quote の USD 上限                       |
| `minSpreadBps`          |                     `3` | fee 負けを避ける最小 quote 幅                |
| `strategy.type`         | `bulk-beta-leaderboard` | Bulk beta live strategy                      |
| `baseHalfSpreadBps`     |                   `2.5` | strategy base half spread                    |
| `inventorySoftLimitQty` |                  `0.08` | side multiplier soft limit                   |
| `inventoryHardLimitQty` |                  `0.18` | quote stop hard limit                        |
| `maxPositionQty`        |                   `0.3` | これを超える在庫は reduce-only IOC で削る    |

## Quote 生成フロー

```mermaid
flowchart TD
  S["MarketSnapshot"] --> F["fairPrice = markWeight * markPrice<br/>+ (1 - markWeight) * microPrice"]
  S --> V["sigma = EWMA(log return variance)^0.5"]
  F --> Q["quoteSize = min(positionSize, budgetUsd / fairPrice)"]
  V --> A["Configured strategy"]
  Q --> A
  P["Position.qty"] --> A
  A --> R["strategy quote<br/>prices + side size multipliers"]
  R --> B["bid ladder"]
  R --> C["ask ladder"]
```

### 1. Fair price

`FairPriceCalculator` は mark price と micro price を混ぜる。

```text
fairPrice = markWeight * markPrice + (1 - markWeight) * microPrice
```

現在の `markWeight` は `0.5` なので、mark と micro を半分ずつ見る。
micro price は板の top depth を反映するため、単純な mid price より order book の偏りを拾いやすい。

### 2. Volatility

`VolatilityEstimator` は直近 price の log return を EWMA で分散化し、平方根を `sigma` として返す。

```text
logReturn = log(currentMarkPrice / previousMarkPrice)
variance  = alpha * logReturn^2 + (1 - alpha) * previousVariance
sigma     = sqrt(variance)
```

`alpha` の default は `0.2`。
直近の値動きが大きいほど `sigma` が上がり、`gamma > 0` のとき spread と inventory skew に反映される。

### 3. Quote size

片側の発注 size は `positionSize` と `budgetUsd / fairPrice` の小さい方。

```text
quoteSize = min(positionSize, budgetUsd / fairPrice)
```

BTC が高いほど `budgetUsd` 側で size が絞られる。
現在は `positionSize = 0.2`、`budgetUsd = 5000` なので、BTC-USD では通常 `budgetUsd / fairPrice` が上限になる。両側 quote の合計 notional は約 10,000 USD を狙う。

## Avellaneda-Stoikov 部分

この bot の strategy は、fair price を中心に次の 2 つを計算する。

```mermaid
flowchart LR
  FP["fairPrice"] --> RP["reservationPrice"]
  Pos["positionQty"] --> Skew["inventorySkew"]
  Sigma["sigma"] --> Spread["spread"]
  Sigma --> Skew
  Params["gamma / kappa / kInv"] --> Spread
  Params --> Skew
  Skew --> RP
  Spread --> BidAsk["bid / ask"]
  RP --> BidAsk
```

### Spread

`gamma = 0` の場合、strategy spread は fixed-spread fallback になる。

```text
strategySpread = 2 / kappa
```

現在は `kappa = 12` なので:

```text
strategySpread = 2 / 12 = 0.1667
```

これは price の絶対値幅で、bps ではない。BTC-USD のような高価格 market では非常に細い幅になるため、Bulk config は fee-aware な `minSpreadBps` を下限として適用する。

`gamma > 0` の場合は Avellaneda-Stoikov 型の spread を使う。

```text
varianceTerm = sigma^2 * timeHorizonSec
spread = gamma * varianceTerm + (2 / gamma) * log(1 + gamma / kappa)
```

最終的な quote 幅:

```text
minSpread = fairPrice * minSpreadBps / 10_000
spread = max(strategySpread, minSpread)
```

直感:

| 値      | 上げるとどうなるか                                      |
| ------- | ------------------------------------------------------- |
| `gamma` | risk aversion が強くなり、spread が広がりやすい         |
| `sigma` | 値動きが荒いほど spread が広がる                        |
| `kappa` | 大きいほど fixed-spread fallback では spread が狭くなる |

### Inventory skew

在庫が偏っていると、reservation price をずらして片側の約定を起こしやすくする。

```text
normalizedInventory = tanh(positionQty / inventoryScale)
inventorySkew = normalizedInventory * kInv * sigma * sqrt(timeHorizonSec)
reservationPrice = fairPrice - inventorySkew
```

`tanh` を使うので、position が大きくなっても skew はなめらかに飽和する。

```mermaid
flowchart LR
  Long["Long inventory<br/>positionQty > 0"] --> Lower["reservationPrice lower"]
  Lower --> LowerBid["bid lower<br/>buy less attractive"]
  Lower --> LowerAsk["ask lower<br/>sell more attractive"]

  Short["Short inventory<br/>positionQty < 0"] --> Higher["reservationPrice higher"]
  Higher --> HigherBid["bid higher<br/>buy more attractive"]
  Higher --> HigherAsk["ask higher<br/>sell less attractive"]
```

結果:

| Position | reservation price | 期待する効果                            |
| -------- | ----------------- | --------------------------------------- |
| Long     | 下がる            | sell 側を約定させやすくして在庫を減らす |
| Short    | 上がる            | buy 側を約定させやすくして在庫を戻す    |
| Flat     | fair price 近辺   | symmetric quote                         |

## Final quote

最終的な quote は以下。

```text
bid = max(0, reservationPrice - spread / 2)
ask = max(0, reservationPrice + spread / 2)
bidSize = quoteSize
askSize = quoteSize
```

通常は `defaultTimeInForce = GTC`。
ただし market snapshot の `marginRatio` があり、`marginRatio < slideMarginThreshold` のときは `IOC` に切り替える。

```mermaid
flowchart TD
  MR["marginRatio"] --> Has{"null?"}
  Has -->|yes| GTC["use defaultTimeInForce<br/>GTC"]
  Has -->|no| Low{"marginRatio < 0.06?"}
  Low -->|yes| IOC["use IOC"]
  Low -->|no| GTC
```

## Risk controls around strategy

Strategy は bid / ask を作るだけで、risk control は use case 側で囲っている。

```mermaid
flowchart TD
  Tick["Bot tick"] --> Risk["GuardRiskUseCase"]
  Risk --> State{"RiskState"}
  State -->|EMERGENCY_STOP| Stop["stop bot"]
  State -->|PAUSE_QUOTING| Skip["skip quote refresh"]
  State -->|OK| Reduce["ReduceInventoryUseCase"]
  Reduce --> Need{"abs(positionQty) > maxPositionQty?"}
  Need -->|yes| IOC["reduce-only IOC at best bid/ask"]
  Need -->|no| Refresh["RefreshQuotesUseCase"]
  IOC --> Refresh
  Refresh --> Orders["reconcile + place changed bid/ask"]
```

Risk thresholds:

| Risk             | 条件                                | 動作                            |
| ---------------- | ----------------------------------- | ------------------------------- |
| `EMERGENCY_STOP` | `marginRatio < mmrBuffer`           | bot を止める                    |
| `PAUSE_QUOTING`  | `marginRatio < imrBuffer`           | quote refresh を止める          |
| Reduce inventory | `abs(positionQty) > maxPositionQty` | 超過分を reduce-only IOC で削る |

現在値:

| 項目             |     値 |
| ---------------- | -----: |
| `imrBuffer`      | `0.06` |
| `mmrBuffer`      | `0.03` |
| `maxPositionQty` |  `0.2` |

## PnL-first tuning guide

現在の改善 loop は、volume ではなく PnL を優先する。

```mermaid
flowchart TD
  Eval["Metrics evaluation"] --> Pnl{"Net PnL > 0<br/>and PnL/notional > 0?"}
  Pnl -->|no| Defensive["Do not chase fills<br/>reduce kappa or create strategy issue"]
  Pnl -->|yes| Markout{"5s markout positive<br/>adverse < 30%?"}
  Markout -->|no| Wider["increase gamma / widen flow"]
  Markout -->|yes| Fill{"fill rate too low?"}
  Fill -->|yes| More["increase kappa carefully"]
  Fill -->|no| Hold["keep config, collect more data"]
```

Guideline:

| 状態                                  | 優先する判断                                  |
| ------------------------------------- | --------------------------------------------- |
| Net PnL が負                          | fill rate を上げない                          |
| PnL per notional が非正               | volume を増やさない                           |
| markout が負                          | 逆選択を疑い、spread / risk aversion を見直す |
| PnL も markout も良いが fill が少ない | 初めて `kappa` を上げる候補になる             |

## 実装対応表

| 内容                   | 実装                                                 |
| ---------------------- | ---------------------------------------------------- |
| tick orchestration     | `src/application/Bot.ts`                             |
| quote refresh          | `src/application/usecases/RefreshQuotesUseCase.ts`   |
| risk gate              | `src/application/usecases/GuardRiskUseCase.ts`       |
| inventory reduction    | `src/application/usecases/ReduceInventoryUseCase.ts` |
| quote composition      | `src/domain/QuoteEngine.ts`                          |
| fair price             | `src/domain/FairPriceCalculator.ts`                  |
| volatility             | `src/domain/VolatilityEstimator.ts`                  |
| strategy formula       | `src/domain/strategy/*/*Strategy.ts`                 |
| strategy params schema | `src/domain/strategy/*/*Params.ts`                   |
| Bulk beta live params  | `config/config.bulk.beta.yml`                        |
| Bulk mainnet params    | `config/config.bulk.mainnet.yml`                     |
