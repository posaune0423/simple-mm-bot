# TECH

## 目的

この文書は `simple-mm-bot` の技術設計を定義する。
現在の実装方針は Bulk Trade primary であり、Bullet は対応対象に含めない。

## 技術スタック

- Runtime: Bun
- Language: TypeScript
- Validation: Zod
- ORM / Migration: Drizzle ORM
- Local DB: SQLite (`bun:sqlite`)
- Production DB: PostgreSQL (`postgres.js`)
- Venue SDK: `bulk-ts-sdk`
- Deploy: Docker on Railway

Bulk Trade には公式 TypeScript SDK がないため、Bulk API wrapper として `bulk-ts-sdk` を使用する。
bot 本体は Bulk API payload を直接構築せず、`src/adapters/bulk/` と `bulk-ts-sdk` の境界に閉じ込める。

## アーキテクチャ方針

Clean Architecture を採用し、core trading runtime の依存方向は内側の domain に向かう。
metrics fact contract と agent/operator tool logic は core market making domain から分離する。

| 層             | 責務                                                               | 依存可能先                             |
| -------------- | ------------------------------------------------------------------ | -------------------------------------- |
| Domain         | 純粋なビジネスロジック、entity、port、strategy                     | 外部依存なし                           |
| Application    | use case の実行順序、bot ループ、DI 構成                           | domain                                 |
| Adapters       | venue / mode ごとの port 実装                                      | domain ports + venue SDK               |
| Infrastructure | metrics fact contract、DB client、schema、repository 実装          | domain ports + storage library         |
| Scripts        | 保存済み metrics facts / views の評価、YAML tuning、issue planning | domain entities + infrastructure types |

## ランタイム全体像

`main.ts` は config を読み込み、DI container を組み立て、`Bot` を起動するだけに保つ。

bot の 1 tick は以下の責務順で動作する。

1. `GuardRiskUseCase` を実行する
2. `OK` の場合のみ `RefreshQuotesUseCase` を実行する
3. inventory が閾値超過なら `ReduceInventoryUseCase` を実行する
4. fill event は `RecordFillUseCase` で保存する
5. metrics fact は `MetricsRecorder` で保存し、分析は DB view で読む

この流れにより、mode や venue を知らない共通の bot ループを維持する。

## Domain 設計

### Entities

- `Quote`
  - bid / ask price
  - bid / ask size
  - order policy
- `Position`
  - qty
  - avg entry
  - unrealized PnL
- `Fill`
  - 約定イベントの正規化表現
- `PerformanceMetrics`
  - script / docs report 用の集計型

### Ports

- `IMarketFeed`
  - `getSnapshot()`
  - `subscribe()`
- `IOrderGateway`
  - `place(order)`
  - `cancel(id)`
  - `cancelAll()`
- `IPositionRepository`
- `ITradeRepository`
- `IOhlcvRepository`

### Strategy / Quote Engine

初期実装は `AvellanedaStoikovStrategy` とする。
`QuoteEngine` は fair price、volatility、strategy params、quote sizing、`defaultTimeInForce` を統合して最終 quote を生成する。

主要パラメータ:

| パラメータ     | 意味                  | 想定範囲                       | 推奨値 |
| -------------- | --------------------- | ------------------------------ | ------ |
| `gamma`        | リスク回避係数        | `0.001-0.5`、ただし `0` を許容 | `0.02` |
| `kappa`        | fill intensity 推定値 | `> 0`                          | `1.5`  |
| `kInv`         | inventory skew 係数   | `0-2`                          | `0.3`  |
| `positionSize` | 基本発注サイズ        | `> 0`                          | `0.01` |
| `budgetUsd`    | 発注あたり予算上限    | `> 0`                          | `100`  |

Bulk の初期 `defaultTimeInForce` は `GTC` とする。
Hyperliquid path では既存の `ALO` default を維持する。

## Application 設計

### DI Container

`src/application/di.ts` を venue、mode、DB の唯一の解決地点にする。

#### Venue / Mode 解決

- `bulk + live` -> `BulkMarketFeed` + `BulkOrderGateway`
- `bulk + paper` -> `BulkMarketFeed` + `PaperOrderGateway`
- `bulk + backtest` -> unsupported error
- `hyperliquid + live` -> `HyperliquidMarketFeed` + `HyperliquidOrderGateway`
- `hyperliquid + paper` -> `HyperliquidMarketFeed` + `PaperOrderGateway`
- `hyperliquid + backtest` -> `HistoricalMarketFeed` + `PaperOrderGateway`

Hyperliquid backtest は暫定の historical validation path として残す。
Bullet の DI path は持たない。

#### DB 解決

- `DATABASE_URL` あり -> PostgreSQL repository 群
- `DATABASE_URL` なし -> SQLite repository 群

## Adapter 設計

### Bulk Trade

- `BulkMarketFeed`
  - HTTP ticker / L2 book で初期 snapshot を作る
  - WS ticker / L2 snapshot で snapshot を更新する
  - WS candle から実 OHLCV を取り込み、top-of-book snapshot から volume=0 candle を作らない
  - 購読直後の historical candle batch は最新分だけ処理し、起動時の DB 書き込み量を bounded に保つ
  - Bulk timestamp は ns から ms に正規化する
  - best bid/ask と size から microprice を計算する
  - account id がある場合のみ margin を取得する
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

- default は SQLite
- production 推奨は PostgreSQL
- 切り替え条件は `DATABASE_URL` の有無に一本化する

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

`telemetry_events`, `markouts`, `quote_decisions`, `runtime_incidents` は作らない。
`v_run_performance` を run 評価の入口にし、PnL、drawdown、order quality、markout、market quality、inventory risk は view で集計する。

`ohlcv` は backtest / historical cache 用の別枠として残す。Bulk live / paper の成績評価では OHLCV ではなく `orderbook_snapshots` を使う。

## 設定管理

- default config: `config/config.bulk.yml`
- Bulk paper preset: `config/config.paper.yml`
- Bulk template: `config/config.example.yml`
- Temporary Hyperliquid backtest preset: `config/config.backtest.yml`

環境変数による override:

- `MODE`
- `CONFIG_PATH`
- `DATABASE_URL`
- `DB_PATH`
- `LOG_LEVEL`
- `BULK_PRIVATE_KEY`
- Hyperliquid env vars are kept only for the temporary backtest / legacy path

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
- Bulk paper/live DI が正しい adapter を解決すること
- Bulk backtest が明示的に unsupported error になること
- Bulk market feed が ticker/L2/WS payload を `MarketSnapshot` に正規化すること
- Bulk order gateway が order/cancel/fill を domain model に正規化すること
- `defaultTimeInForce` が quote policy に反映されること
- emergency stop 時に quote が送信されないこと

## デプロイ方針

- Docker base image は `oven/bun:latest`
- Bun で依存解決する
- entrypoint は Bun runtime で bot を起動する
- Railway では env var で mode、DB、`BULK_PRIVATE_KEY` を注入する
