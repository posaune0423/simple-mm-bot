# ARCHITECTURE

`simple-mm-bot` の現在の依存関係、レイヤー責務、1 tick の実行順を図で把握するためのドキュメント。

詳細なディレクトリ責務は [STRUCTURE.md](./STRUCTURE.md)、技術方針は [TECH.md](./TECH.md)、要件は [PRD.md](./PRD.md) を参照。

主対象 venue は **Bulk Trade**。runtime は **Bun + TypeScript**、中心 strategy は **Avellaneda-Stoikov**。

---

## 1. 設計原則

この repo の trading runtime は Clean Architecture で整理する。

- `src/domain/` は純粋な market making logic と port contract。venue SDK、DB、env、logger、runtime validation library を import しない。
- `src/application/` は runtime orchestration。tick loop、use case、DI、order reconcile、metrics recording を担当する。
- `src/adapters/` は venue / mode の protocol 変換。Bulk / Hyperliquid / paper を domain port に合わせる。
- `src/infrastructure/` は storage や runtime metadata。SQLite / Postgres repository、git metadata を置く。
- `src/lib/reporting/` と `scripts/` は bot の外側の分析・可視化・tuning tool。runtime の意思決定に混ぜない。

依存方向は **外側から内側へ**。内側の domain は外側の都合を知らない。この境界は `vite.config.ts` の `no-restricted-imports` で lint enforcement する。

---

## 2. 全体依存図

```mermaid
flowchart LR
    subgraph External["External world"]
        Bulk["Bulk Trade API / WS"]
        HL["Hyperliquid API / WS"]
        DB[("SQLite / Postgres")]
        YAML["config/*.yml"]
        Env["process.env / .env"]
    end

    subgraph Boot["Boot"]
        Main["main.ts"]
        Config["ConfigLoader\nValibot validation\nenv override"]
        DI["DIContainer\ncomposition root"]
    end

    subgraph Application["Application"]
        Bot["Bot\nlifecycle + tick loop"]
        UseCases["Use cases\nGuardRisk\nInitializePosition\nRefreshQuotes\nReduceInventory\nClosePosition\nRecordOhlcv\nUpdatePositionOnFill"]
        QuoteRefresh["QuoteRefreshService\nstrategy + intents + reconcile"]
        IntentBuilder["OrderIntentBuilder\nQuote -> OrderIntent"]
        Reconciler["ManagedOrderReconciler\norder reconcile"]
        MetricsRec["MetricsRecorder\nfact writer"]
        StrategyFactory["StrategyFactory"]
        QuoteModelFactory["QuoteModelFactory"]
    end

    subgraph Domain["Domain (pure)"]
        QE["QuoteEngine"]
        Strategy["Strategy\nSimplePmmStrategy"]
        QuoteModel["QuoteModel\nAvellanedaStoikovQuoteModel"]
        Fair["FairPriceCalculator"]
        Vol["VolatilityEstimator"]
        Values["Value objects\nQuote / QuoteLeg / OrderIntent\nStrategyDecision"]
        Entities["Entities\nQuote / Position / Fill"]
        Ports["Ports\nIMarketFeed\nIOrderGateway\nIPositionRepository\nIOhlcvRepository\nIMarkoutFeedbackRepository\nIMetricsRepository"]
    end

    subgraph Adapters["Adapters"]
        BulkAdapter["bulk\nBulkMarketFeed\nBulkOrderGateway\nBulkOhlcvFetcher"]
        HLAdapter["hyperliquid\nHyperliquidMarketFeed\nHyperliquidOrderGateway\nHyperliquidOhlcvFetcher"]
        PaperAdapter["paper\nHistoricalMarketFeed\nPaperOrderGateway"]
    end

    subgraph Infrastructure["Infrastructure"]
        Repos["Repository implementations\nSqliteMetrics/Ohlcv\nPostgresMetrics/Ohlcv\nInMemoryPosition"]
        GitMeta["GitMetadata"]
    end

    YAML --> Config
    Env --> Config
    Main --> Config --> DI --> Bot
    DI --> StrategyFactory --> Strategy
    DI --> QuoteModelFactory --> QuoteModel
    DI --> QE
    DI --> Repos
    DI --> BulkAdapter
    DI --> HLAdapter
    DI --> PaperAdapter

    Bot --> UseCases
    Bot --> MetricsRec
    UseCases --> QuoteRefresh
    QuoteRefresh --> Strategy
    QuoteRefresh --> IntentBuilder
    QuoteRefresh --> Reconciler
    UseCases --> Ports
    UseCases --> Reconciler
    MetricsRec --> Ports

    Strategy --> QE
    QE --> QuoteModel
    QE --> Fair
    QE --> Vol
    QE --> Entities
    QE --> Values

    BulkAdapter -. implements .-> Ports
    HLAdapter -. implements .-> Ports
    PaperAdapter -. implements .-> Ports
    Repos -. implements .-> Ports

    BulkAdapter --> Bulk
    HLAdapter --> HL
    Repos --> DB
    DI --> GitMeta
```

読み方:

- `DIContainer` だけが「どの venue / mode / DB 実装を使うか」を知る。
- `Bot` と use case は `IMarketFeed` / `IOrderGateway` などの port だけを見る。
- `QuoteEngine` は `QuoteModel` interface にだけ依存し、Avellaneda-Stoikov の具象生成は `QuoteModelFactory` に閉じる。
- `StrategyFactory` は bot behavior strategy を組み立てる。`strategies/` には `Strategy` contract と具象 strategy 実装を置き、`StrategyDecision` は value object として扱う。
- `MetricsRecorder` は runtime から fact を保存するだけ。評価結果や report は DB view / reporting tool 側で作る。

---

## 3. レイヤー責務

| Layer             | 主な責務                                                                                             | 依存可能先                                           | 代表ファイル                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain            | quote 計算、quote model、strategy、fair price、volatility、value object、entity、port、fact contract | domain 内のみ                                        | `src/domain/services/QuoteEngine.ts`, `src/domain/quote-models/*`, `src/domain/strategies/*`, `src/domain/value-objects/*`, `src/domain/ports/*` |
| Application       | bot lifecycle、tick 順序、use case orchestration、DI、order reconcile、metrics fact recording        | domain。`src/application/di.ts` のみ外側を組み立てる | `src/application/Bot.ts`, `src/application/usecases/*`, `src/application/services/*`, `src/application/di.ts`                                    |
| Adapters          | Bulk / Hyperliquid / paper の外部 protocol を domain port へ変換                                     | domain ports、venue SDK / local replay               | `src/adapters/bulk/*`, `src/adapters/hyperliquid/*`, `src/adapters/paper/*`                                                                      |
| Infrastructure    | DB client、schema、domain port 実装、git metadata                                                    | domain ports、storage library                        | `src/infrastructure/*`, `src/infrastructure/db/*`                                                                                                |
| Tools / Reporting | 保存済み metrics の評価、report 生成、config tuning、issue planning                                  | source runtime から分離                              | `scripts/*`, `src/lib/reporting/*`                                                                                                               |

### Lint-Enforced Dependency Matrix

`vite.config.ts` の lint rule は次を落とす。

| Scope                   | 禁止 import                                                                                                                | 例外                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| all source layers       | `zod`                                                                                                                      | なし。runtime validation は `valibot` に統一する                   |
| `src/domain/**`         | `application` / `adapters` / `infrastructure` / `lib` / `config` / `env` / `utils` / `valibot` / DB / SDK / Node built-ins | domain 内 import のみ                                              |
| `src/application/**`    | `adapters` / `infrastructure` / `lib`                                                                                      | `src/application/di.ts` は composition root として具象を組み立てる |
| `src/adapters/**`       | `application` / `infrastructure`                                                                                           | domain port と venue SDK / local replay は許可                     |
| `src/infrastructure/**` | `application` / `adapters`                                                                                                 | domain port の実装として domain import は許可                      |
| `src/lib/**`            | runtime layers                                                                                                             | reporting / helper logic を bot runtime へ混ぜない                 |

Validation 責務:

- `src/env.ts` と `src/config.ts` だけが Valibot schema を持つ。
- domain strategy parameter file は pure type のみ。`AvellanedaStoikovParams` の制約は config validation 側で検証する。
- `@t3-oss/env-core` は Valibot schema で env を検証し、空文字は `undefined` として扱う。

---

## 4. 主要クラスの責務

| Component                     | 責務                                                                                                                 | 持たない責務                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `main.ts`                     | config load、DI build、process signal を `AbortSignal` に変換、`Bot.start()` 呼び出し                                | venue 分岐、注文判断、DB 操作        |
| `DIContainer`                 | venue × mode × DB の具象解決、use case と adapter の組み立て                                                         | tick 実行、trading 判断              |
| `Bot`                         | 起動・接続・購読・tick loop・cleanup、event task drain                                                               | quote price 計算、venue payload 生成 |
| `GuardRiskUseCase`            | snapshot の margin / risk state を `OK` / `PAUSE_QUOTING` / `EMERGENCY_STOP` に分類                                  | 注文発行                             |
| `QuoteRefreshService`         | snapshot / position / markout feedback を読み、Strategy、OrderIntentBuilder、OrderReconciler を順に呼ぶ              | venue SDK 直接操作、strategy 実装    |
| `OrderIntentBuilder`          | `Quote` を venue-neutral な `OrderIntent[]` に変換し、execution policy を適用                                        | order reconcile、venue API 呼び出し  |
| `ManagedOrderReconciler`      | 前回 order と今回 intent の差分 reconcile、必要な cancel / replace / reuse                                           | quote 価格計算、risk 判定            |
| `ReduceInventoryUseCase`      | inventory / loss / adverse move が閾値を超えた時に reduce-only order を出す                                          | 通常 quote の維持                    |
| `ClosePositionUseCase`        | shutdown / emergency 時の position flatten                                                                           | tick 中の quoting                    |
| `MetricsRecorder`             | run metadata、orderbook snapshot、submitted order、fill、account state を fact として保存                            | PnL 判断、report 生成                |
| `QuoteEngine`                 | fair price、sigma、quote model output、ladder、size/distance multiplier、budget/notional cap、exposure intent を合成 | venue / mode / DB の知識             |
| `AvellanedaStoikovQuoteModel` | spread と inventory skew から raw model quote を計算                                                                 | ladder、budget cap、adapter payload  |
| `BulkMarketFeed`              | Bulk HTTP / WS から snapshot、OHLCV、margin/position freshness を正規化                                              | order placement                      |
| `BulkOrderGateway`            | domain order を Bulk order API に変換し、fills / order events を domain に正規化                                     | quote generation                     |
| `PaperOrderGateway`           | live order を送らず paper fill を simulation                                                                         | market data fetch                    |
| `HistoricalMarketFeed`        | OHLCV repository / fetcher から時系列 replay                                                                         | execution simulation                 |

---

## 5. 1 Tick の流れ

現在の `Bot.runTick()` は、risk check、event drain、inventory reduction、quote refresh、historical feed advance の順で動く。

```mermaid
sequenceDiagram
    autonumber
    participant Bot
    participant Guard as GuardRiskUseCase
    participant Queue as Event task queue
    participant Reduce as ReduceInventoryUseCase
    participant Refresh as QuoteRefreshService
    participant Strategy as Strategy
    participant Builder as OrderIntentBuilder
    participant Reconciler as ManagedOrderReconciler
    participant Feed as IMarketFeed
    participant Pos as IPositionRepository
    participant Feedback as IMarkoutFeedbackRepository
    participant QE as QuoteEngine
    participant GW as IOrderGateway
    participant Metrics as MetricsRecorder

    Bot->>Guard: execute()
    Guard->>Feed: getSnapshot()
    Guard-->>Bot: OK / PAUSE_QUOTING / EMERGENCY_STOP

    alt EMERGENCY_STOP
        Bot->>Bot: mark emergency stop
        Bot-->>Bot: stop tick loop
    else continue
        Bot->>Queue: drainEventTasks()
        Queue->>Metrics: record snapshots / fills / order events
        Queue->>Pos: update position on fill

        Bot->>Reduce: executeIfNeeded()
        Reduce->>Pos: get()
        Reduce->>Feed: getSnapshot()
        opt threshold exceeded
            Reduce->>GW: place reduce-only order
        end
        Reduce-->>Bot: didReduceInventory

        alt riskState == OK and didReduceInventory == false
            Bot->>Refresh: execute()
            Refresh->>Feed: getSnapshot()
            Refresh->>Pos: get()
            opt qualityGate enabled
                Refresh->>Feedback: getRecentSideMarkoutFeedback()
            end
            Refresh->>Strategy: decide(snapshot, position, quality)
            Strategy->>QE: compute(QuoteEngineInput)
            QE-->>Strategy: Quote
            Strategy-->>Refresh: StrategyDecision.quote
            Refresh->>Metrics: recordQuote()
            loop each side / level
                Refresh->>Feed: getSnapshot()
                Refresh->>Metrics: recordMarketSnapshot()
                Refresh->>Refresh: stale touch / momentum guard / guarded limit price
            end
            Refresh->>Builder: build(Quote, placement context)
            Builder-->>Refresh: OrderIntent[]
            Refresh->>Reconciler: reconcile(intents)
            Reconciler->>GW: cancel stale/replaced orders
            Reconciler->>GW: place missing/replaced orders
            Reconciler-->>Refresh: ReconcileResult
        else paused or reducing
            Bot-->>Bot: skip quote refresh
        end

        opt historical feed
            Bot->>Feed: advance()
        end
    end
```

重要な分岐:

- `PAUSE_QUOTING` は新規 quote を出さないが、event drain と inventory reduction は動く。
- `ReduceInventoryUseCase` が注文した tick では `QuoteRefreshService` をスキップする。
- `QuoteRefreshService` は通常 tick で blanket `cancelAll()` しない。`ManagedOrderReconciler` が差分 cancel / replace を行う。
- `ManagedOrderReconciler` が cancel 失敗で注文状態を信頼できない場合だけ、unknown state として `cancelAll()` に倒す。

---

## 6. 起動から購読まで

```mermaid
sequenceDiagram
    autonumber
    participant Main as main.ts
    participant Config as ConfigLoader
    participant DI as DIContainer
    participant Bot
    participant Feed as IMarketFeed
    participant GW as IOrderGateway
    participant Init as InitializePositionUseCase
    participant Metrics as MetricsRecorder
    participant Ohlcv as RecordOhlcvUseCase
    participant Pos as UpdatePositionOnFillUseCase

    Main->>Config: load(CONFIG_PATH)
    Config-->>Main: AppConfig
    Main->>DI: new DIContainer(config)
    Main->>DI: buildBot()
    DI-->>Main: Bot
    Main->>Bot: start()

    Bot->>Metrics: start(run metadata)
    Bot->>Feed: connect()
    Bot->>GW: syncFills()
    Bot->>Init: execute()
    Init->>GW: getPosition()
    Init-->>Bot: seed in-memory position

    Bot->>Feed: subscribe(snapshot handler)
    Bot->>GW: subscribeFills(fill handler)
    Bot->>GW: subscribeOrderEvents(order handler)
    Bot->>Feed: getSnapshot()
    Bot->>Ohlcv: record initial snapshot when OHLCV-shaped
    Note over Bot: tick loop starts after subscriptions are active
```

Fill / order event は tick と同期実行せず、`Bot` の event task queue に積まれる。各 tick の前半で drain され、position と metrics の鮮度をそろえる。

---

## 7. QuoteEngine 内部

`QuoteEngine` は quote model output をそのまま返すだけではなく、ladder、sizing、exposure intent、budget cap を合成して `Quote` value object を作る中心点になっている。

```mermaid
flowchart TD
    Snap["MarketSnapshot\nbestBid / bestAsk\nmarkPrice / microPrice\nmarginRatio\navailableMarginUsd"]
    Position["Position\nqty / avgEntry / unrealizedPnl"]
    Config["QuoteEngine config\nmarkWeight\ninventoryScale\ntimeHorizonSec\nminSpreadBps\nsizing\nlevels\nmaxLeverage"]
    SideSpecs["QuoteSideSpecs\nstrategy output"]

    Fair["FairPriceCalculator\nmark/micro weighted fair"]
    Vol["VolatilityEstimator\nEWMA sigma"]
    Model["QuoteModel\nAvellanedaStoikovQuoteModel"]
    ModelQuote["ModelQuote\nbid / ask / reservation"]
    Levels["Configured levels\nhalfSpreadBps + sizeUsd"]
    Multipliers["Size / distance multipliers\nconfig + side specs"]
    Caps["Budget / reduce-side / open-notional caps"]
    Quote["Quote VO\nbids / asks\nexposureIntent"]

    Snap --> Fair --> Model
    Snap --> Vol --> Model
    Position --> Model
    Config --> Model
    Model --> ModelQuote
    ModelQuote --> Levels --> Multipliers --> Caps --> Quote
    Position --> Levels
    Position --> Caps
    Snap --> Caps
    SideSpecs --> Multipliers
    SideSpecs --> Caps
```

処理順の要点:

1. `FairPriceCalculator` が mark / micro price から fair price を作る。
2. `VolatilityEstimator` が mark price の EWMA volatility を更新する。
3. `QuoteModel` が base bid / ask / size / reservation price を作る。
4. `quoteEngine.levels` がある場合、ladder quote に展開する。
5. config / strategy side spec の size・distance multiplier を適用する。
6. position 方向に応じて `increase_exposure` / `reduce_exposure` intent を付け、reduce side の qty を現在 position 量までに制限する。
7. `budgetUsd` と Bulk `availableMarginUsd * maxLeverage` から open notional を cap する。

---

## 8. Venue × Mode × DB 解決

`DIContainer` が具象 adapter と repository を選ぶ。application use case は mode / venue branch を持たない。

| venue         | mode       | MarketFeed                                         | OrderGateway              | 主用途                                 |
| ------------- | ---------- | -------------------------------------------------- | ------------------------- | -------------------------------------- |
| `bulk`        | `live`     | `BulkMarketFeed`                                   | `BulkOrderGateway`        | primary live。`BULK_PRIVATE_KEY` 必須  |
| `bulk`        | `paper`    | `BulkMarketFeed`                                   | `PaperOrderGateway`       | live market data + simulated execution |
| `bulk`        | `backtest` | `HistoricalMarketFeed` + `BulkOhlcvFetcher`        | `PaperOrderGateway`       | Bulk OHLCV replay                      |
| `hyperliquid` | `live`     | `HyperliquidMarketFeed`                            | `HyperliquidOrderGateway` | legacy compatibility                   |
| `hyperliquid` | `paper`    | `HyperliquidMarketFeed`                            | `PaperOrderGateway`       | legacy compatibility                   |
| `hyperliquid` | `backtest` | `HistoricalMarketFeed` + `HyperliquidOhlcvFetcher` | `PaperOrderGateway`       | legacy backtest                        |

```mermaid
flowchart TD
    Start["DIContainer.buildBot()"]
    DBQ{DATABASE_URL scheme}
    Venue{config.venue}
    ModeBulk{config.mode}
    ModeHL{config.mode}

    Start --> DBQ
    DBQ -- "postgres:// or postgresql://" --> PG["PostgresMetricsRepository\nPostgresOhlcvRepository"]
    DBQ -- "file:<path>" --> SQLite["SqliteMetricsRepository\nSqliteOhlcvRepository\nSqliteMetricsRepository as IMarkoutFeedbackRepository"]
    Start --> Pos["InMemoryPositionRepository"]
    Start --> QuoteModel["buildQuoteModel()\nAvellanedaStoikovQuoteModel"]
    Start --> Strategy["buildStrategy()\nSimplePmmStrategy"]
    Start --> QE["QuoteEngine"]
    Start --> Venue

    Venue -- bulk --> BulkClient["BulkClient\nbulk-ts-sdk"]
    BulkClient --> ModeBulk
    ModeBulk -- live --> BulkLive["BulkMarketFeed\nBulkOrderGateway"]
    ModeBulk -- paper --> BulkPaper["BulkMarketFeed\nPaperOrderGateway"]
    ModeBulk -- backtest --> BulkBacktest["HistoricalMarketFeed\nBulkOhlcvFetcher\nPaperOrderGateway"]

    Venue -- hyperliquid --> HLApis["Hyperliquid APIs"]
    HLApis --> ModeHL
    ModeHL -- live --> HLLive["HyperliquidMarketFeed\nHyperliquidOrderGateway"]
    ModeHL -- paper --> HLPaper["HyperliquidMarketFeed\nPaperOrderGateway"]
    ModeHL -- backtest --> HLBacktest["HistoricalMarketFeed\nHyperliquidOhlcvFetcher\nPaperOrderGateway"]
```

DB 解決:

- `DATABASE_URL=postgres://...` / `postgresql://...` は Postgres。
- `DATABASE_URL=file:<path>` は SQLite。既定値は `src/env.ts` の `file:data/mm.db`。
- SQLite metrics repository は `IMarkoutFeedbackRepository` も実装し、quality gate の markout feedback に使われる。

---

## 9. Ports & Adapters

```mermaid
flowchart LR
    subgraph DomainPorts["Domain ports"]
        IMF["IMarketFeed\nconnect / getSnapshot / subscribe / advance?"]
        IOG["IOrderGateway\nplace / cancel / cancelAll\nsubscribeFills / getPosition?"]
        IPOS["IPositionRepository\nget / update / set"]
        IOHLCV["IOhlcvRepository\nupsert / range query"]
        IQUAL["IMarkoutFeedbackRepository\nrecent side markout feedback"]
        IMETRICS["IMetricsRepository\nmetrics fact writes"]
    end

    subgraph AdapterInfra["Adapters / Infrastructure"]
        BMF["BulkMarketFeed"] --> IMF
        HLMF["HyperliquidMarketFeed"] --> IMF
        HIST["HistoricalMarketFeed"] --> IMF
        BOG["BulkOrderGateway"] --> IOG
        HLOG["HyperliquidOrderGateway"] --> IOG
        POG["PaperOrderGateway"] --> IOG
        MEM["InMemoryPositionRepository"] --> IPOS
        SOH["SqliteOhlcvRepository"] --> IOHLCV
        POH["PostgresOhlcvRepository"] --> IOHLCV
        SM["SqliteMetricsRepository"] --> IQUAL
        SM --> IMETRICS
        PM["PostgresMetricsRepository"] --> IMETRICS
    end

    subgraph ExternalSystems["External systems"]
        BulkExt["Bulk API / WS"]
        HLExt["Hyperliquid API / WS"]
        Storage[("SQLite / Postgres")]
    end

    BMF --> BulkExt
    BOG --> BulkExt
    HLMF --> HLExt
    HLOG --> HLExt
    SOH --> Storage
    POH --> Storage
    SM --> Storage
    PM --> Storage
```

Port の使い分け:

- market data は `IMarketFeed`。live / paper は subscribe、backtest は `advance()` で replay する。
- execution は `IOrderGateway`。live adapter は venue API、paper adapter は simulation。
- position は tick loop 中は `InMemoryPositionRepository`。startup と fill event で更新する。
- OHLCV は backtest replay と candle cache 用。live performance 評価は orderbook / fill facts を使う。
- markout feedback は保存済み fill markout から side ごとの control signal を作る。
- metrics fact は `IMetricsRepository` と fact 型を `src/domain/ports/IMetricsRepository.ts` に置き、SQLite / Postgres が実装する。

---

## 10. Metrics / Analysis Data Flow

runtime は「後から検証できる fact」だけを保存する。評価や report は保存済み fact / view から作る。

```mermaid
flowchart LR
    subgraph Runtime["Runtime"]
        FeedEvent["Market snapshot"]
        QuoteEvent["Quote decision"]
        OrderEvent["Order event"]
        FillEvent["Fill"]
        AccountEvent["Account / margin state"]
    end

    Recorder["MetricsRecorder"]
    Repo["IMetricsRepository"]
    Facts[("Fact tables\ntrading_runs\norderbook_snapshots\nsubmitted_orders\ntrade_fills\naccount_state_observations")]
    Views["DB views\nv_run_performance\nv_fill_markouts\nquality queries"]
    Scripts["scripts/*\nmetrics:evaluate\nmetrics:report\nmetrics:tune\nmetrics:issues"]
    Reports["data/metrics/*\ndocs/reports/*\nGitHub issue drafts"]

    FeedEvent --> Recorder
    QuoteEvent --> Recorder
    OrderEvent --> Recorder
    FillEvent --> Recorder
    AccountEvent --> Recorder
    Recorder --> Repo --> Facts --> Views --> Scripts --> Reports
```

実装上の境界:

- `MetricsRecorder` は application にあるが、保存先の interface は `IMetricsRepository`。
- `src/domain/ports/IMetricsRepository.ts` は fact 型と metrics repository contract。
- `SqliteMetricsRepository` / `PostgresMetricsRepository` が DB schema に変換する。
- `src/lib/reporting/*` と `scripts/*` は保存済みデータから成果物を作るだけで、runtime quote 判断へ import しない。

---

## 11. Risk State

```mermaid
stateDiagram-v2
    [*] --> OK
    OK --> PAUSE_QUOTING: marginRatio < imrBuffer
    OK --> EMERGENCY_STOP: marginRatio < mmrBuffer
    PAUSE_QUOTING --> OK: marginRatio recovers
    PAUSE_QUOTING --> EMERGENCY_STOP: marginRatio < mmrBuffer
    OK --> OK: marginRatio == null
    EMERGENCY_STOP --> [*]: stop loop -> cleanup
```

挙動:

- `OK`: quote refresh 可能。
- `PAUSE_QUOTING`: quote refresh はスキップ。event drain と inventory reduction は継続。
- `EMERGENCY_STOP`: tick loop を止め、cleanup で `cancelAll()`。`shutdown.closePositionPolicy` が `emergency_only` でも close position を実行する。

---

## 12. Config / Secret Flow

```mermaid
flowchart LR
    ConfigFile["config/*.yml\ncommitted presets"]
    EnvFile[".env / process.env\nsecrets and overrides"]
    Interp["${VAR} interpolation"]
    Valibot["appConfigSchema\nValibot parse"]
    Override["applyEnvOverrides\nMODE\nBULK_PRIVATE_KEY\nHL_* legacy"]
    AppConfig["AppConfig"]
    DI["DIContainer"]

    ConfigFile --> Interp
    EnvFile --> Interp
    Interp --> Valibot --> Override --> AppConfig --> DI
```

現在の主要 env:

- `CONFIG_PATH`: 読み込む YAML。default は `config/config.bulk.beta.yml`。
- `MODE`: `live` / `paper` / `backtest` override。
- `DATABASE_URL`: `file:<path>` なら SQLite、`postgres://` / `postgresql://` なら Postgres。default は `file:data/mm.db`。
- `BULK_PRIVATE_KEY`: Bulk live order placement 用。
- `LOG_LEVEL`: repo logger の filter。
- `HL_*`: Hyperliquid legacy path 用。

secret env は `src/env.ts` と config override 以外から直接読まない。

---

## 13. 変更時のチェックリスト

- [ ] `src/domain/**` が `application` / `adapters` / `infrastructure` / `utils` を import していない。
- [ ] Bulk API / SDK 型は `src/adapters/bulk/**` と `bulk-ts-sdk` 境界に閉じている。
- [ ] 新規 pricing model は `QuoteModel` 実装 + config schema + `QuoteModelFactory` の変更で足りる。
- [ ] 新規 bot behavior は `Strategy` 実装 + config schema + `StrategyFactory` の変更で足りる。
- [ ] 新規 venue は `src/adapters/<venue>/` + `DIContainer` の分岐追加で足りる。
- [ ] `Bot` の tick 順序を変える時は、risk state、event drain、inventory reduction、quote refresh、cleanup の相互作用を更新する。
- [ ] 通常 tick の quote 更新で blanket `cancelAll()` を増やさない。必要な場合は `ManagedOrderReconciler` の unknown-state fallback として扱う。
- [ ] runtime は fact を保存し、評価結果は DB view / scripts / reporting 側で作る。
- [ ] `scripts/*` や `src/lib/reporting/*` の分析 logic を runtime quote 判断に import しない。
