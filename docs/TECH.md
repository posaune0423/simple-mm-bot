# TECH

## 目的

この文書は `simple-mm-bot` の技術設計を定義する。
PRD が示す要件を、どのようなアーキテクチャ、責務分割、技術選定、検証方針で実現するかを整理する。

## 技術スタック

- Runtime: Bun
- Language: TypeScript
- Validation: Zod
- ORM / Migration: Drizzle ORM
- Local DB: SQLite (`bun:sqlite`)
- Production DB: PostgreSQL (`postgres.js`)
- Deploy: Docker on Railway

## アーキテクチャ方針

Clean Architecture を採用し、依存方向は常に内側の domain に向かう。

| 層             | 責務                                           | 依存可能先                     |
| -------------- | ---------------------------------------------- | ------------------------------ |
| Domain         | 純粋なビジネスロジック、entity、port、strategy | 外部依存なし                   |
| Application    | use case の実行順序、bot ループ、DI 構成       | domain                         |
| Adapters       | venue / mode ごとの port 実装                  | domain ports                   |
| Infrastructure | DB client、schema、repository 実装             | domain ports + storage library |

## ランタイム全体像

`main.ts` は config を読み込み、DI container を組み立て、`Bot` を起動するだけに保つ。

bot の 1 tick は以下の責務順で動作する。

1. `GuardRiskUseCase` を実行する
2. `OK` の場合のみ `RefreshQuotesUseCase` を実行する
3. inventory が閾値超過なら `ReduceInventoryUseCase` を実行する
4. fill event は `RecordFillUseCase` で保存する
5. 必要に応じて `BuildReportUseCase` で report を生成する

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
- `Report`
  - metrics
  - equity curve
  - fill analysis

### Ports

- `IMarketFeed`
  - `getSnapshot()`
  - `subscribe()`
- `IOrderGateway`
  - `place(order)`
  - `cancel(id)`
  - `cancelAll()`
- `IPositionRepository`
  - 現在ポジションの取得と更新
- `ITradeRepository`
  - fill の保存と期間検索
- `IReportRepository`
  - report の保存と参照
- `IOhlcvRepository`
  - replay 用 candle の保存と取得

### Strategy

strategy の抽象は `IQuotingStrategy` で統一する。
初期実装は `AvellanedaStoikovStrategy` とし、`gamma = 0` で fixed spread 相当の挙動を吸収する。

主要パラメータ:

| パラメータ | 意味                  | 想定範囲                       | 推奨値 |
| ---------- | --------------------- | ------------------------------ | ------ |
| `gamma`    | リスク回避係数        | `0.001-0.5`、ただし `0` を許容 | `0.02` |
| `kappa`    | fill intensity 推定値 | `> 0`                          | `1.5`  |
| `kInv`     | inventory skew 係数   | `0-2`                          | `0.3`  |
| `baseSize` | 基本発注サイズ        | `> 0`                          | `0.01` |

これらは Zod schema で定義し、config 読み込み時と runtime で同一ルールを使う。

### Fair Price と Volatility

- `FairPriceCalculator`
  - mark price と microprice を混合して fair price を計算する
- `VolatilityEstimator`
  - EWMA sigma を用いて短期ボラティリティを推定する
- `QuoteEngine`
  - strategy、fair price、volatility、config を統合して最終 quote を生成する

デフォルトの fair price は以下とする。

```text
fair = markWeight * markPrice + (1 - markWeight) * microprice
```

## Application 設計

### `Bot`

`Bot` は runtime loop のみを担当し、venue や mode の知識を持たない。
注入された use case を順番に実行する orchestration の薄い層として保つ。

### Use Cases

| UseCase                  | 責務                                                           |
| ------------------------ | -------------------------------------------------------------- |
| `RefreshQuotesUseCase`   | 現在注文の cancel、quote 計算、bid / ask 発注                  |
| `RecordFillUseCase`      | fill 保存と position 更新                                      |
| `GuardRiskUseCase`       | margin 状態を `OK` / `PAUSE_QUOTING` / `EMERGENCY_STOP` に変換 |
| `ReduceInventoryUseCase` | inventory 超過時に reduce-only IOC を発行                      |
| `BuildReportUseCase`     | fills から report を生成・保存                                 |

### DI Container

`src/application/di.ts` を venue、mode、DB の唯一の解決地点にする。
このルールにより、他レイヤーで具体実装への依存が漏れ出るのを防ぐ。

#### Venue / Mode 解決

- `bullet + live` -> `BulletMarketFeed` + `BulletOrderGateway`
- `bullet + paper` -> `BulletMarketFeed` + `PaperOrderGateway`
- `bullet + replay` -> `HistoricalMarketFeed` + `PaperOrderGateway`
- `hyperliquid + live` -> `HyperliquidMarketFeed` + `HyperliquidOrderGateway`
- `hyperliquid + paper` -> `HyperliquidMarketFeed` + `PaperOrderGateway`
- `hyperliquid + replay` -> `HistoricalMarketFeed` + `PaperOrderGateway`

#### DB 解決

- `DATABASE_URL` あり -> PostgreSQL repository 群
- `DATABASE_URL` なし -> SQLite repository 群

## Adapter 設計

### Bullet

- `BulletMarketFeed`
  - WebSocket で orderbook、mark price、funding rate を購読する
- `BulletOrderGateway`
  - domain order を Bullet API へ変換する
  - `PostOnly`、`PostOnlySlide`、`PostOnlyFront` を扱う
- `BulletOhlcvFetcher`
  - replay 用 OHLCV を REST API から取得する

### Hyperliquid

- `HyperliquidMarketFeed`
  - L2 orderbook を購読する
- `HyperliquidOrderGateway`
  - domain order を Hyperliquid order semantics へ変換する
  - `ALO (GTX)`、`GTC`、`IOC` を扱う
- `HyperliquidOhlcvFetcher`
  - replay 用 OHLCV を取得する

### Paper / Replay

- `PaperOrderGateway`
  - 実注文は送らず fill をシミュレートする
  - bid / ask spread と market activity を基に約定判定する
- `HistoricalMarketFeed`
  - repository から OHLCV を読む
  - 不足分を fetcher から取得する
  - 取得した OHLCV を cache する
  - 時系列順に replay する

## Bullet 固有の技術判断

### Order Policy

Bullet の post-only 振る舞いは domain の `order policy` として quote 結果に含め、最終的な API 変換は `BulletOrderGateway` が担当する。

- `PostOnly`
  - クロスしそうならキャンセル
- `PostOnlySlide`
  - クロスしそうなら best price へスライド
- `PostOnlyFront`
  - queue priority を取るため 1 tick 前に置く

`marginRatio` が `slideMarginThreshold` を下回った場合、より保守的な policy に切り替える。

### Margin Risk State

`GuardRiskUseCase` は Bullet の unified cross margin を前提に、以下の状態遷移を返す。

- `OK`
  - `marginRatio >= imrBuffer`
- `PAUSE_QUOTING`
  - `mmrBuffer <= marginRatio < imrBuffer`
- `EMERGENCY_STOP`
  - `marginRatio < mmrBuffer`

これにより、強制 cancel や liquidation に近い状態で risk-increasing order を避ける。

## Persistence 設計

### DB 切り替え

- default は SQLite
- production 推奨は PostgreSQL
- 切り替え条件は `DATABASE_URL` の有無に一本化する

### テーブル

| テーブル  | 用途                                   | 主なカラム                                                           |
| --------- | -------------------------------------- | -------------------------------------------------------------------- |
| `fills`   | fill 履歴、PnL、execution quality 分析 | venue, market, side, price, qty, fee, trade_pnl, filled_at           |
| `reports` | session 集計結果                       | mode, venue, period range, net_pnl, markout_5s, max_drawdown, sharpe |
| `ohlcv`   | replay 用履歴 cache                    | market, ts, open, high, low, close, volume                           |

`ohlcv` は `market + ts` の複合 primary key を持つ。

### Drizzle

Drizzle config は `DATABASE_URL` に応じて dialect、schema path、migration 出力先、接続情報を切り替える。

## 設定管理

設定の責務は以下に分ける。

- mode / venue
- venue ごとの接続設定
- quote engine 設定
- strategy type / params
- risk threshold
- bot interval
- replay range / timeframe

環境変数による override:

- `MODE`
- `CONFIG_PATH`
- `DATABASE_URL`
- `DB_PATH`
- venue ごとの API / WS credential

## テスト方針

| テスト種別                 | 対象                              | 方針                      |
| -------------------------- | --------------------------------- | ------------------------- |
| Domain unit                | strategy、quote engine、analytics | 外部依存なし              |
| Application unit           | use case                          | ports を mock             |
| Infrastructure integration | repository                        | 実 SQLite を使用          |
| Paper E2E                  | bot 全体                          | live feed + sim execution |

重点検証項目:

- `gamma = 0` で fixed spread 相当になること
- volatility 上昇で spread が広がること
- inventory 偏りで quote が skew すること
- emergency stop 時に quote が送信されないこと
- `cancelAll -> place` の順序が守られること
- report で PnL、drawdown、sharpe、markout 系指標が正しく計算されること

## デプロイ方針

### Docker

- base image は `oven/bun:latest`
- Bun で依存解決する
- entrypoint は Bun runtime で bot を起動する

### Railway

- `Dockerfile` で build する
- env var で mode と credential を注入する
- 初期は SQLite でも動作可能
- 本番は Railway PostgreSQL addon を前提とする

## 拡張パス

以下の拡張を、依存方向を壊さず行える構造にする。

- venue 追加
- strategy 追加
- multi-level quoting
- Analytics の toxic flow 拡張
- 別プロジェクトとしての XEMM 派生
