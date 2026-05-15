# TECH

## 目的

この文書は `simple-mm-bot` の技術設計を定義する。
現在の実装方針は Bulk Trade primary であり、Bullet は対応対象に含めない。

## 技術スタック

- Runtime: Bun
- Language: TypeScript
- Error handling: `neverthrow` `Result` / `ResultAsync`
- Pattern matching: `ts-pattern`
- Validation: Valibot
- linter / formatter: vite plus
- ORM / Migration: Drizzle ORM
- DB: SQLite (`bun:sqlite`) / PostgreSQL (`postgres.js`)
- Venue SDK: `bulk-ts-sdk`
- Deploy: Hetzner VPS

Bulk Trade には公式 TypeScript SDK がないため、Bulk API wrapper として `bulk-ts-sdk` を使用する。
bot 本体は Bulk API payload を直接構築せず、`src/adapters/bulk/` と `bulk-ts-sdk` の境界に閉じ込める。

## アーキテクチャ方針

DDD / Clean Architecture を採用し、core trading runtime の依存方向は内側の domain に向かう。
metrics fact contract と agent/operator tool logic は core market making domain から分離する。

| 層             | 責務                                                                 | 依存可能先                          |
| -------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Domain         | 純粋なビジネスロジック、value object、plain contract、port、strategy | 外部依存なし                        |
| Application    | use case の実行順序、bot ループ、DI 構成                             | domain                              |
| Adapters       | venue / mode ごとの port 実装                                        | domain ports + venue SDK            |
| Infrastructure | metrics fact contract、DB client、schema、repository 実装            | domain ports + storage library      |
| Scripts        | 保存済み metrics facts / views の評価、YAML tuning、issue planning   | domain types + infrastructure types |

設計原則:

- TypeScript の型を先に設計し、domain type、value object、port、use case contract で層間の境界を表現する
- domain は venue SDK、DB、HTTP、WS、logger、config loader を import しない
- application は use case orchestration と port 利用に集中し、SDK payload や SQL schema を直接扱わない
- adapter / infrastructure は外部 payload と domain contract の変換を担当し、外側の都合を内側へ漏らさない

## 型安全なエラー処理と分岐

Expected failure は `neverthrow` の `Result` / `ResultAsync` で表現する。

- value object factory、domain service、strategy、quote model は validation / calculation failure を `Result<T, DomainError>` で返す
- application use case / service は recoverable な domain failure、order reconciliation failure、position sync failure などを layer-owned error として `Result` で返す
- adapter / infrastructure は venue rejection、timeout、DB write failure など caller が判断できる failure を typed error に正規化し、可能な範囲で `Result` に載せる
- startup failure、process boundary の fatal error、invariant violation のように継続不能なものは throw してよい
- `try/catch` は外部 API / DB / process boundary の変換点に寄せ、business rule の分岐には使わない

閉じた union / state / routing の分岐には `ts-pattern` を使う。

- venue / mode / DB scheme の解決
- risk state、strategy decision、position side、order side、exposure intent の組み合わせ
- transient error policy、runtime policy、report period など exhaustive に扱うべき設定分岐

単純な null guard、数値 validation、短い早期 return は通常の `if` を優先する。
`ts-pattern` を使う場合は `.exhaustive()` で union の追加漏れを型で検出し、該当テストも同じ変更で更新する。

## ランタイム全体像

`main.ts` は config を読み込み、DI container を組み立て、`Bot` を起動するだけに保つ。

bot の 1 tick は以下の責務順で動作する。

1. `GuardRiskUseCase` を実行する
2. event task を drain する
3. 必要なら `SyncPositionUseCase` で venue position を同期する
4. inventory が閾値超過なら `ReduceInventoryUseCase` を実行する
5. risk が `OK` かつ reduce 未実行の場合だけ `QuotingCycleService` を実行する
6. fill event は `MetricsRecorder` で fact DB に保存し、`UpdatePositionOnFillUseCase` で position を更新する
7. metrics fact は `MetricsRecorder` で保存し、分析は DB view で読む

この流れにより、mode や venue を知らない共通の bot ループを維持する。

## Domain 設計

### Value Objects / Types

- `value-objects/Quote`
  - 新しい quote VO。bid/ask leg、reference/fair price、diagnostics を持ち、execution policy は持たない。
- `value-objects/OrderIntent`
  - submit 前の注文意図。time-in-force、post-only、reduce-only、client order id はここで扱う。
- `types/Position`
  - 現行 runtime の position contract。identity / lifecycle を持たないため Entity ではない。
- `types/Fill`
  - adapter が正規化して application へ渡す fill event contract。identity lifecycle を管理しないため Entity ではない。
- `types/LegacyQuote`
  - legacy metrics / adapter 互換用の旧 quote contract。一時的な型置き場であり、VO ではない。
- `types/PerformanceMetrics`
  - backtest / paper loop script の集計 contract。runtime domain entity ではない。

### Ports

- `IMarketFeed`
  - `getSnapshot()`
  - `subscribe()`
- `IOrderGateway`
  - `place(order)`
  - `cancel(id)`
  - `cancelAll()`
- `IPositionRepository`
- `IOhlcvRepository`

### Strategy / Quote Model / Quote Engine

`AvellanedaStoikovQuoteModel` は pricing model であり、bot behavior strategy ではない。ladder は別 strategy ではなく `quoteEngine.levels` で quote expansion として設定する。
`SimplePmmStrategy` は side markout feedback を見て side spec を作り、`QuoteEngine` に quote 計算を委譲する。
`QuoteEngine` は fair price、volatility、quote model output、quote sizing、budget/notional cap、exposure intent を統合して新 `Quote` value object を生成する。
time-in-force、post-only、reduce-only、client order id は quote ではなく `OrderIntentBuilder` / `OrderIntent` 側で扱う。
`QuoteEngine` は `QuoteModel` interface のみへ依存し、具体 quote model を import しない。

主要パラメータ:

| パラメータ     | 意味                  | 想定範囲                       | 推奨値 |
| -------------- | --------------------- | ------------------------------ | ------ |
| `gamma`        | リスク回避係数        | `0.001-0.5`、ただし `0` を許容 | `0.02` |
| `kappa`        | fill intensity 推定値 | `> 0`                          | `1.5`  |
| `kInv`         | inventory skew 係数   | `0-2`                          | `0.3`  |
| `minSpreadBps` | 最小 quote 幅         | `>= 0`                         | `5.6`  |
| `positionSize` | 基本発注サイズ        | `> 0`                          | `0.01` |
| `budgetUsd`    | 発注あたり予算上限    | `> 0`                          | `100`  |

Bulk の初期 `defaultTimeInForce` は `GTC` とする。
Hyperliquid path では既存の `ALO` default を維持する。
Bulk beta leaderboard strategy は在庫が soft limit に近づくほど同方向 quote size を薄くし、反対方向 quote size を厚くする。hard limit 超過時は在庫を増やす側の quote size を 0 にする。

## Application 設計

### DI Container

`src/application/di.ts` を venue、mode、DB の唯一の解決地点にする。

#### Venue / Mode 解決

- `bulk + live` -> `BulkMarketFeed` + `BulkOrderGateway`
- `bulk + paper` -> `BulkMarketFeed` + `PaperOrderGateway`
- `bulk + backtest` -> `HistoricalMarketFeed` + `PaperOrderGateway`
- `hyperliquid + live` -> `HyperliquidMarketFeed` + `HyperliquidOrderGateway`
- `hyperliquid + paper` -> `HyperliquidMarketFeed` + `PaperOrderGateway`
- `hyperliquid + backtest` -> `HistoricalMarketFeed` + `PaperOrderGateway`

Bulk backtest は `bulk-ts-sdk` の `klines` から OHLCV を取得し、historical replay feed と paper execution を組み合わせる。現行の Bulk SDK/API では historical L2 を取得できないため、backtest の fill quality は OHLCV 粒度と paper fill model に依存する。
Bullet の DI path は持たない。

#### DB 解決

- `DATABASE_URL=file:<path>` -> SQLite repository 群
- `DATABASE_URL=postgres://...` / `postgresql://...` -> PostgreSQL repository 群

#### Quote Order Reconcile

`QuotingCycleService` は通常 tick で blanket `cancelAll()` を行わない。
`Strategy` が `Quote` を返し、`OrderIntentBuilder` が venue-neutral な `OrderIntent[]` へ変換し、`OrderReconciler` が前回 order と今回 intent を比較して価格/サイズ差分が閾値以上の order だけ cancel/replace する。
`Bot` cleanup は open order cleanup のため `cancelAll()` を実行し、`shutdown.closePositionPolicy` が `emergency_only` の場合は通常停止で market close を行わず、emergency stop 時だけ close use case を実行する。

## Adapter 設計

### Bulk Trade

- `BulkMarketFeed`
  - HTTP ticker / L2 book で初期 snapshot を作る
  - WS ticker / L2 snapshot で snapshot を更新する
  - WS candle から実 OHLCV を取り込み、top-of-book snapshot から volume=0 candle を作らない
  - 購読直後の historical candle batch は最新分だけ処理し、起動時の DB 書き込み量を bounded に保つ
  - Bulk timestamp は ns から ms に正規化する
  - best bid/ask と size から microprice を計算する
  - account id がある場合のみ margin / position を初期取得し、account poller で freshness を更新する
- `BulkOrderGateway`
  - domain order を `bulk-ts-sdk` の `placeLimitOrder` / `placeMarketOrder` / `cancelOrder` / `cancelAll` に変換する
  - `response.data.statuses` から order id と status を抽出する
  - `account.fills(accountId)` を poll して maker/taker buy/sell を domain `Fill` に正規化する

### Hyperliquid

- Backtest と既存 smoke 用の adapter として維持する
- Bulk main 運用に必要な新規機能は Hyperliquid 側へ追加しない

### Paper / Historical

- `PaperOrderGateway`
  - 実注文は送らず fill をシミュレートする
- `HistoricalMarketFeed`
  - repository から OHLCV を読む
  - 不足分を fetcher から取得する
  - 時系列順に replay する
- `RecordOhlcvUseCase`
  - live / paper の venue OHLCV candle を 1m OHLCV として保存する
  - Bulk では WS candle 由来の open / high / low / close / volume がある snapshot だけを保存する
  - top-of-book / ticker だけの snapshot は OHLCV として保存しない
  - 同一 candle は repository の upsert で更新する

## Bulk 固有の技術判断

### SDK Boundary

Bulk Trade には公式 TypeScript SDK がない。
そのため、この bot は自前実装の `bulk-ts-sdk` を利用する。

責務分担:

- `bulk-ts-sdk`: Bulk HTTP/WS/signing/order/account API を TypeScript surface として提供する
- `src/adapters/bulk`: SDK payload を domain model へ変換し、bot の port を実装する
- domain/application: Bulk API や SDK の型を import しない

### Config / Env

Bulk HTTP URL、WS URL、market、L2 depth は committed YAML config に置く。
secret env は現時点では `BULK_PRIVATE_KEY` のみ。

Bulk live order placement は `BULK_PRIVATE_KEY` を要求する。
Bulk paper mode は `BULK_PRIVATE_KEY` なしで動作する。
Bulk API schema には leverage 更新用の `updateUserSettings` が存在するが、現在利用している `bulk-ts-sdk` の typed helper は order / cancel 系に限定される。
そのため bot は `connections.bulk.maxLeverage` を自動設定値として扱わず、`fullAccount.leverageSettings` を初回注文前に検証する guard として扱う。
Bulk UI または SDK が正式対応した API path で leverage を先に下げ、bot は account leverage が `maxLeverage` を超えていれば live order を送らず fail closed する。

### Time In Force

Bulk の現行 exchange info は `GTC` と `IOC` を扱う前提のため、Bulk config の `defaultTimeInForce` は `GTC` とする。

## Persistence 設計

### DB 切り替え

- default は SQLite (`DATABASE_URL=file:data/mm.db`)
- production 推奨は PostgreSQL
- 切り替え条件は `DATABASE_URL` の scheme に一本化する
- `file:<path>` は SQLite、`postgres://` / `postgresql://` は PostgreSQL

### Low-cost data foundation target

常時 market-data collection と replay backtest の次世代設計は `docs/DATABASE.md` と
`docs/DATA_FOUNDATION.md` に置く。現行 `data/mm.db` は run-centric metrics DB として維持し、
target design では public market data と run/accounting facts を分離する。

- market data: `data/market/<venue>/<yyyy-mm>.sqlite`
- run/accounting facts: `data/runs/<venue>.sqlite`
- replay dataset metadata: `data/strategy-runs/<timestamp>-<label>/manifest.json`

funding-aware PnL は `trade_pnl - fee` だけで評価しない。target design では
`funding_accruals` と `ledger_entries` を accounting source of truth にし、
trade PnL、fee/rebate、funding PnL、inventory PnL を分解して集計する。

### Metrics tables

core metrics DB は「後から評価できる fact」だけを保存する。
分析結果は table ではなく view で計算する。

| テーブル                     | 用途                              | 主なカラム                                                     |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `trading_runs`               | run 単位の分析軸                  | mode, venue, market, capital_mode, strategy_name, git metadata |
| `orderbook_snapshots`        | spread / staleness / markout join | best_bid, best_ask, mid_price, mark_price, spread_bps          |
| `submitted_orders`           | order quality                     | client_order_id, venue_order_id, intent, status, latency       |
| `trade_fills`                | PnL / fee / volume / fill quality | venue_fill_id, venue_order_id, price, quantity, fee, trade_pnl |
| `account_state_observations` | inventory / margin / equity risk  | equity, realized_pnl, unrealized_pnl, position_qty, margin     |
| `runtime_health_events`      | runtime health / skip fact        | level, code, message, observed_at, raw_json                    |
| `quote_decisions`            | side / level quote decision fact  | quote_cycle_id, side, level, intent, price, quantity, context  |
| `order_lifecycle_events`     | raw gateway lifecycle event       | action, client_order_id, venue_order_id, status, latency       |

`telemetry_events`, `markouts`, `runtime_incidents` は作らない。
`quote_decisions` と `runtime_health_events` は edge 探索に必要な raw fact として保存する。
`v_run_performance` を run 評価の入口にし、PnL、drawdown、order quality、markout、market quality、inventory risk は view で集計する。

`ohlcv` は backtest / historical cache 用の別枠として残す。Bulk live / paper の成績評価では OHLCV ではなく `orderbook_snapshots` を使う。

## 設定管理

- default config selection: `CONFIG_VENUE=bulk`, `CONFIG_PRESET=beta`
- Bulk beta preset: `config/bulk/beta.yml`
- Bulk tight-spread canary preset: `config/bulk/tight-near-touch.yml`
- Bulk micro tight-spread canary preset: `config/bulk/tight-near-touch-micro.yml`
- Bulk maker-quality tight-spread canary preset: `config/bulk/tight-near-touch-maker.yml`
- Bulk inner-level maker tight-spread canary preset: `config/bulk/tight-near-touch-inner-maker.yml`
- Bulk mainnet preset: `config/bulk/mainnet.yml`
- Bulk template: `config/bulk/example.yml`
- Paper and backtest use the same venue preset with `MODE` override

Runtime env default は `src/env.ts` に閉じる。Drizzle schema / migration path は `drizzle.config.ts` に置き、script / report / agent loop 用の default path は `scripts/lib/paths.ts` に集約する。

環境変数による override:

- `MODE`
- `CONFIG_VENUE`
- `CONFIG_PRESET`
- `CONFIG_PATH`
- `DATABASE_URL` (default: `file:data/mm.db`)
- `LOG_LEVEL`
- `BULK_PRIVATE_KEY`
- Hyperliquid env vars are kept only for legacy compatibility paths

Log output should go through `src/utils/logger.ts` by default so `LOG_LEVEL` filtering applies consistently.

### Logging

Operational logs use consistent event-style messages through `src/utils/logger.ts`.

- `INFO`: runtime lifecycle, market feed connection, initial market snapshot, quote submission, order submission/cancel, fills, inventory reduction, and cleanup
- `WARN`: risk guard pauses / emergency stops, rejected order responses, and recoverable polling or unsubscribe failures
- `ERROR`: startup failures and unrecoverable application errors
- `DEBUG`: high-frequency tick state, websocket market updates, fill polling, historical replay advancement, and persistence details

This keeps `LOG_LEVEL=INFO` useful for normal paper/live operation while allowing `LOG_LEVEL=DEBUG` when investigating feed or tick-level behavior.

## テスト方針

| テスト種別                 | 対象                              | 方針                      |
| -------------------------- | --------------------------------- | ------------------------- |
| Domain unit                | strategy、quote engine、analytics | 外部依存なし              |
| Application unit           | use case、DI                      | ports を mock             |
| Adapter unit               | Bulk feed/order mapping           | SDK shape を test double  |
| Scripts unit               | metrics evaluation / tuning       | 保存済み入力を fixture 化 |
| Infrastructure integration | repository                        | 実 SQLite を使用          |
| Paper E2E                  | bot 全体                          | live feed + sim execution |

重点検証項目:

- Bulk config が parse できること
- Bulk paper/live/backtest DI が正しい adapter を解決すること
- Bulk market feed が ticker/L2/WS payload を `MarketSnapshot` に正規化すること
- Bulk order gateway が order/cancel/fill を domain model に正規化すること
- `defaultTimeInForce` が quote policy に反映されること
- emergency stop 時に quote が送信されないこと

## デプロイ方針

- Docker base image は `oven/bun:latest`
- Bun で依存解決する
- entrypoint は Bun runtime で bot を起動する
- Hetzner VPS では `.env` または systemd/Docker Compose の environment で mode、DB、`BULK_PRIVATE_KEY` を注入する
