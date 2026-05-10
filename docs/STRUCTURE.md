# STRUCTURE

この文書は `simple-mm-bot` の現在の構成と、各ディレクトリの責務を定義する。

現在の主対象 venue は Bulk Trade。Bullet は対応対象に含めない。
Bulk Trade には公式 TypeScript SDK がないため、repo owner が API を wrap して実装した `bulk-ts-sdk` を adapter 層から利用する。

## ディレクトリ構成

```text
simple-mm-bot/
├── src/
│   ├── main.ts
│   ├── env.ts
│   ├── config.ts
│   ├── application/
│   │   ├── Bot.ts
│   │   ├── di.ts
│   │   ├── MetricsRecorder.ts
│   │   ├── OrderManager.ts
│   │   ├── QuotingStrategyFactory.ts
│   │   ├── shutdown.ts
│   │   └── usecases/
│   │       ├── ClosePositionUseCase.ts
│   │       ├── GuardRiskUseCase.ts
│   │       ├── RecordOhlcvUseCase.ts
│   │       ├── ReduceInventoryUseCase.ts
│   │       ├── RefreshQuotesUseCase.ts
│   │       └── UpdatePositionOnFillUseCase.ts
│   ├── domain/
│   │   ├── entities/
│   │   ├── ports/
│   │   ├── strategy/
│   │   ├── FairPriceCalculator.ts
│   │   ├── MarketContext.ts
│   │   ├── MarketContextBuilder.ts
│   │   ├── QuoteEngine.ts
│   │   └── VolatilityEstimator.ts
│   ├── adapters/
│   │   ├── bulk/
│   │   │   ├── BulkMarketFeed.ts
│   │   │   ├── BulkOhlcvFetcher.ts
│   │   │   └── BulkOrderGateway.ts
│   │   ├── hyperliquid/
│   │   │   ├── HyperliquidMarketFeed.ts
│   │   │   ├── HyperliquidOhlcvFetcher.ts
│   │   │   └── HyperliquidOrderGateway.ts
│   │   └── paper/
│   │       ├── HistoricalMarketFeed.ts
│   │       └── PaperOrderGateway.ts
│   ├── infrastructure/
│   │   ├── Metrics.ts
│   │   ├── MetricsRepository.ts
│   │   └── db/
│   │       ├── postgres/
│   │       └── sqlite/
│   │           ├── bootstrap.ts
│   │           ├── client.ts
│   │           └── schema.ts
│   ├── utils/
│   └── lib/
│       ├── hyperliquid/
│       └── reporting/
│           ├── metrics/
│           ├── queries/
│           ├── report/
│           └── svg/
├── config/
│   ├── config.bulk.beta.yml
│   ├── config.bulk.mainnet.yml
│   ├── config.paper.yml
│   ├── config.backtest.yml
│   └── config.example.yml
├── tests/
│   ├── adapters/
│   ├── application/
│   ├── domain/
│   ├── scripts/
│   ├── e2e/
│   ├── infrastructure/
│   └── reporting/
├── scripts/
│   ├── backtestPaperLoop.ts
│   ├── evaluateLiveRun.ts
│   ├── tuneBulkConfig.ts
│   ├── createDesignIssues.ts
│   ├── generateMetricsReport.ts
│   └── lib/
│       ├── paths.ts
│       ├── MetricsEvaluation.ts
│       ├── BulkConfigTuning.ts
│       └── DesignIssuePlanner.ts
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PRD.md
│   ├── TECH.md
│   ├── STRUCTURE.md
│   ├── storategy.md
│   ├── venue/
│   │   └── bulk/
│   │       └── README.md
│   └── specs/
├── data/
│   ├── mm.db
│   ├── metrics/
│   └── strategy-runs/
└── package.json
```

## レイヤー責務

### `src/domain/`

純粋な market making logic を置く。

- venue SDK を import しない
- DB 実装を import しない
- env を直接読まない
- adapter payload を entity に持ち込まない

`QuoteEngine` は strategy、fair price、volatility、risk sizing、`minSpreadBps` の最小幅を組み合わせて quote を生成する。
`MarketContext` / `MarketContextBuilder` は component freshness、外部価格差、LOB/risk context など venue 非依存の market context を構築する純粋 domain code として置く。
Strategy は `src/domain/strategy/*` に pure domain code として置き、`QuotingStrategyFactory` が config の `quoteEngine.strategy.type` から具象実装を組み立てる。
Time in force は config の `quoteEngine.defaultTimeInForce` から渡され、Bulk Trade では当面 `GTC` を使う。

metrics evaluation、Bulk config tuning、GitHub issue planning などの自己改善 loop は market making domain ではないため、`src/domain/` に置かない。

### `src/application/`

bot runtime と use case orchestration を置く。

- tick loop を管理する
- domain service を組み合わせる
- market snapshot / order / fill / account risk を metrics fact として保存する
- `di.ts` で mode / venue / repository を解決する
- venue protocol や SQL を直接書かない

`di.ts` が具体実装を知る唯一の application 境界。
`OrderManager.ts` は quote order の application-level reconcile を担当し、通常 tick では価格/サイズ差分が閾値以上の order だけ cancel/replace する。startup/emergency/cleanup の blanket `cancelAll()` は `Bot` / gateway lifecycle 側に限定する。

`shutdown.ts` は runtime shutdown の共通処理を持つ。position close などの取引処理は use case 経由で実行し、signal handling から venue protocol を直接触らない。

### `src/adapters/`

外部 venue と domain ports の変換層。

#### `src/adapters/bulk/`

Bulk Trade の primary adapter。

- `BulkMarketFeed.ts`
  - `bulk-ts-sdk` で ticker / L2 を取得する
  - HTTP snapshot を seed し、WS ticker / L2 snapshot で更新する
  - WS candle から 1m OHLCV を取得する
  - 購読直後の historical candle batch は最新分だけ処理し、quote tick loop とは同期させない
  - Bulk timestamp は ns から ms に正規化する
  - top book から mid / microprice を計算する
  - account id が利用できる場合のみ margin ratio を取得する
- `BulkOhlcvFetcher.ts`
  - `bulk-ts-sdk` の `market.klines` から historical OHLCV を取得する
  - Bulk `backtest` の replay feed 用に domain `OhlcvRecord` へ正規化する
- `BulkOrderGateway.ts`
  - domain order を `placeLimitOrder` / `placeMarketOrder` に変換する
  - cancel / cancelAll を SDK に委譲する
  - `response.data.statuses` から order id と reject reason を読む
  - `account.fills(accountId)` を poll し、fills を domain `Fill` に正規化する

#### `src/adapters/hyperliquid/`

既存の Hyperliquid adapter。
当面は historical backtest / legacy validation path として維持する。
Bulk main 運用に必要な新規機能はここへ追加しない。

#### `src/adapters/paper/`

venue 非依存の paper execution。
Bulk paper mode では `BulkMarketFeed` と `PaperOrderGateway` を組み合わせる。

### `src/infrastructure/`

DB など外部 storage の詳細を置く。

- SQLite は local / lightweight operation 用
- Postgres は production 用
- repository は domain ports と metrics repository contract を実装し、schema 都合を上位層に漏らさない
- `Metrics.ts` は core metrics fact contract を定義する
- `MetricsRepository.ts` は metrics repository port を定義する
- SQLite の runtime DDL と table / view name list は `src/infrastructure/db/sqlite/bootstrap.ts`
- SQLite / Drizzle table mapping は `src/infrastructure/db/sqlite/schema.ts`
- metrics は `trading_runs`, `orderbook_snapshots`, `submitted_orders`, `trade_fills`, `account_state_observations` に保存する
- `telemetry_events`, `markouts`, `quote_decisions`, `runtime_incidents` は作らず、分析結果は view で計算する

### `src/application/MetricsRecorder.ts`

Bot runtime から run metadata、orderbook snapshot、submitted order、trade fill、account state observation を保存する。
Bulk beta live は runtime mode は `live` のまま、metrics 上の `capitalMode` を `beta_mock` として明示する。

### `scripts/lib/`

Bot の外側で agent や operator が使う評価・tuning・issue planning logic を置く。
runtime source ではなく tool 用 script の実装詳細として扱う。

- `MetricsEvaluation.ts`
  - 保存済み metrics facts / views から data health、PnL、markout、order quality、runtime health を評価する
- `BulkConfigTuning.ts`
  - `config/config.bulk.beta.yml` への最小YAML tuningだけを扱うBulk固有tool logic
- `DesignIssuePlanner.ts`
  - SDK/API/code/design修正が必要な metrics signal をGitHub issue案へ変換する
- `paths.ts`
  - script / agent loop 用の default config、DB、metrics output、report output path を定義する

`scripts/lib/` は bot runtime の意思決定に import しない。

Runtime default は `src/env.ts`、Drizzle schema / migration path は `drizzle.config.ts`、script / report / agent loop の default path は `scripts/lib/paths.ts` に置く。
`src` 直下に repo 運用用の path registry を作らない。

## Data Layout

生成データは原則 `data/` 配下へ置く。`src/`、`scripts/`、`docs/` の source file 生成とは分け、local runtime / agent loop が読む state として扱う。

- `data/mm.db`
  - default SQLite DB。`DATABASE_URL` がなく、`DB_PATH` も未指定の場合に live / paper / backtest / metrics scripts が読む。
  - 通常の backtest、paper、live optimization はこの同一 DB を共有する。`trading_runs.id` と mode / venue / market / capitalMode で run を分離し、複数 run の比較や latest run 評価を DB 内で行う。
  - run ごとに DB を分けるのは、破壊的検証、fixture 再現、または既存 DB を汚したくない isolated experiment のときだけ。使う場合は `--db data/tmp/<label>.db` や一時 path を明示する。
- `data/metrics/`
  - bot 性能評価結果の格納先。
  - `bun run metrics:evaluate` は `evaluation.json` を `data/metrics/<run_id>/`、または明示した `--output-dir` に書く。
  - agent が直近 run を続けて扱う場合は `--output-dir data/metrics/latest` を使い、`metrics:report` / `metrics:tune` / `metrics:issues` は `data/metrics/latest/evaluation.json` を読む。
  - `metrics-report.md`、`metrics-report.json`、`issues.json`、tuning の dry-run JSON などもここへ置く。
- `data/strategy-runs/`
  - `bun run loop:backtest-paper` の run summary 置き場。
  - `summary.json`、`report.json`、`run.md`、使用 config snapshot を `data/strategy-runs/<timestamp>-<label>/` に保存する。
- `docs/reports/`
  - 人間が review / commit する performance dashboard。`report:generate` の default 出力であり、runtime state ではなく git 管理可能な report snapshot として扱う。

### `src/lib/reporting/`

backtest / paper / live の分析出力を置く。

- `metrics/` は drawdown、adverse rate、hourly bucket などの計算
- `queries/` は report 用データ取得
- `report/` は Markdown / KPI table / path 生成
- `svg/` は chart rendering の primitive と chart 実装

bot runtime の意思決定ロジックをここへ入れない。reporting は保存済みデータや report input から成果物を作る責務に限定する。

### `src/utils/`

logger、args、fs、Result helper、error helper などの横断的な小物を置く。
production code の出力は `src/utils/logger.ts` を通す。

### `src/lib/`

外部 API wrapper を置く。現在は Hyperliquid public / exchange / subscription API wrapper と testnet detection を持つ。
Bulk Trade の API wrapper は `bulk-ts-sdk` を利用し、この repo の `src/lib/` へ増やさない。

## Config

`config/` には commit 可能な設定だけを置く。

- `config/config.bulk.beta.yml`
  - Bulk beta live config。日次 10,000 mock USD を使う前提の aggressive preset
- `config/config.bulk.mainnet.yml`
  - Bulk mainnet live config。real capital 用の conservative preset
- `config/config.paper.yml`
  - Bulk Trade paper config
- `config/config.backtest.yml`
  - Bulk historical backtest config
- `config/config.example.yml`
  - safe template with `${BULK_PRIVATE_KEY}`

デフォルトの `CONFIG_PATH` は `config/config.bulk.beta.yml`。

Bulk の HTTP URL、WS URL、market、environment、L2 depth は YAML に置く。
secret env として追加するのは `BULK_PRIVATE_KEY` のみ。

## Docs

`docs/venue/` には venue 固有の exchange rule、fee、risk、execution semantics を置く。
`docs/venue/bulk/README.md` は Bulk Trade の maker / taker fee、commission、HFMM、STP、margin、liquidation ルールの参照資料として使う。
`docs/storategy.md` は current strategy flow、quote formula、Bulk live parameters、inventory reduction policy の参照資料として使う。
runtime 実装や layer boundary の source of truth は引き続き `docs/TECH.md` とこの文書に置く。

## DI Matrix

| venue         | mode       | MarketFeed              | OrderGateway              | status               |
| ------------- | ---------- | ----------------------- | ------------------------- | -------------------- |
| `bulk`        | `paper`    | `BulkMarketFeed`        | `PaperOrderGateway`       | primary              |
| `bulk`        | `live`     | `BulkMarketFeed`        | `BulkOrderGateway`        | primary              |
| `bulk`        | `backtest` | `HistoricalMarketFeed`  | `PaperOrderGateway`       | primary              |
| `hyperliquid` | `backtest` | `HistoricalMarketFeed`  | `PaperOrderGateway`       | legacy compatibility |
| `hyperliquid` | `paper`    | `HyperliquidMarketFeed` | `PaperOrderGateway`       | legacy compatibility |
| `hyperliquid` | `live`     | `HyperliquidMarketFeed` | `HyperliquidOrderGateway` | legacy compatibility |

## 依存ルール

- domain は application / adapters / infrastructure を import しない
- application は domain、infrastructure contracts、DI 対象の具体実装だけを組み合わせる
- Bulk SDK import は `src/adapters/bulk/` に閉じる
- Hyperliquid SDK import は `src/lib/hyperliquid/` と `src/adapters/hyperliquid/` に閉じる
- infrastructure は domain ports / metrics repository contract と storage library に依存する
- scripts は domain entities と infrastructure metrics contract を読めるが、bot runtime からは参照しない
- secret env は `src/env.ts` と config expansion 以外で直接読まない

## テスト構成

- `tests/domain/`
  - strategy、quote engine、analytics の pure unit test
- `tests/scripts/`
  - metrics evaluation、Bulk config tuning、design issue planning の unit test
- `tests/application/`
  - DI、bot loop、use case の orchestration test
- `tests/adapters/`
  - Bulk adapter と venue payload normalization の unit test
- `tests/infrastructure/`
  - SQLite/Postgres repository integration test、report query test
- `tests/reporting/`
  - metrics、Markdown report、SVG chart rendering の unit test
- `tests/e2e/`
  - public feed を使う smoke test

Bulk main path を変更した場合は、少なくとも `bun run lint` と `bun run test` を実行する。
public feed 依存の確認が必要な場合だけ `bun run test:e2e:paper` を追加する。
