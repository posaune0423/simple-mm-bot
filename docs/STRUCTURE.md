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
│   │   └── usecases/
│   ├── domain/
│   │   ├── entities/
│   │   ├── ports/
│   │   ├── strategy/
│   │   ├── Analytics.ts
│   │   ├── FairPriceCalculator.ts
│   │   ├── QuoteEngine.ts
│   │   └── VolatilityEstimator.ts
│   ├── adapters/
│   │   ├── bulk/
│   │   │   ├── BulkMarketFeed.ts
│   │   │   └── BulkOrderGateway.ts
│   │   ├── hyperliquid/
│   │   │   ├── HyperliquidMarketFeed.ts
│   │   │   ├── HyperliquidOhlcvFetcher.ts
│   │   │   └── HyperliquidOrderGateway.ts
│   │   └── paper/
│   │       ├── HistoricalMarketFeed.ts
│   │       └── PaperOrderGateway.ts
│   ├── infrastructure/
│   │   └── db/
│   │       ├── postgres/
│   │       └── sqlite/
│   └── lib/
│       └── hyperliquid/
├── config/
│   ├── config.yml
│   ├── config.bulk.yml
│   ├── config.paper.yml
│   ├── config.backtest.yml
│   └── config.example.yml
├── tests/
│   ├── adapters/
│   ├── application/
│   ├── domain/
│   ├── e2e/
│   └── infrastructure/
├── scripts/
├── docs/
│   ├── PRD.md
│   ├── TECH.md
│   ├── STRUCTURE.md
│   └── specs/
└── package.json
```

## レイヤー責務

### `src/domain/`

純粋な market making logic を置く。

- venue SDK を import しない
- DB 実装を import しない
- env を直接読まない
- adapter payload を entity に持ち込まない

`QuoteEngine` は strategy、fair price、volatility、risk sizing を組み合わせて quote を生成する。
Time in force は config の `quoteEngine.defaultTimeInForce` から渡され、Bulk Trade では当面 `GTC` を使う。

### `src/application/`

bot runtime と use case orchestration を置く。

- tick loop を管理する
- domain service を組み合わせる
- `di.ts` で mode / venue / repository を解決する
- venue protocol や SQL を直接書かない

`di.ts` が具体実装を知る唯一の application 境界。

### `src/adapters/`

外部 venue と domain ports の変換層。

#### `src/adapters/bulk/`

Bulk Trade の primary adapter。

- `BulkMarketFeed.ts`
  - `bulk-ts-sdk` で ticker / L2 を取得する
  - HTTP snapshot を seed し、WS ticker / L2 snapshot で更新する
  - Bulk timestamp は ns から ms に正規化する
  - top book から mid / microprice を計算する
  - account id が利用できる場合のみ margin ratio を取得する
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
- repository は domain ports を実装し、schema 都合を domain に漏らさない

## Config

`config/` には commit 可能な設定だけを置く。

- `config/config.bulk.yml`
  - Bulk Trade primary config
- `config/config.paper.yml`
  - Bulk Trade paper config
- `config/config.yml`
  - default local config
- `config/config.backtest.yml`
  - temporary Hyperliquid historical backtest config
- `config/config.example.yml`
  - safe template with `${BULK_PRIVATE_KEY}`

デフォルトの `CONFIG_PATH` は `config/config.bulk.yml`。

Bulk の HTTP URL、WS URL、market、L2 depth は YAML に置く。
secret env として追加するのは `BULK_PRIVATE_KEY` のみ。

## DI Matrix

| venue         | mode       | MarketFeed              | OrderGateway              | status               |
| ------------- | ---------- | ----------------------- | ------------------------- | -------------------- |
| `bulk`        | `paper`    | `BulkMarketFeed`        | `PaperOrderGateway`       | primary              |
| `bulk`        | `live`     | `BulkMarketFeed`        | `BulkOrderGateway`        | primary              |
| `bulk`        | `backtest` | unsupported             | unsupported               | explicit error       |
| `hyperliquid` | `backtest` | `HistoricalMarketFeed`  | `PaperOrderGateway`       | temporary            |
| `hyperliquid` | `paper`    | `HyperliquidMarketFeed` | `PaperOrderGateway`       | legacy compatibility |
| `hyperliquid` | `live`     | `HyperliquidMarketFeed` | `HyperliquidOrderGateway` | legacy compatibility |

## 依存ルール

- domain は application / adapters / infrastructure を import しない
- application は domain と DI 対象の具体実装だけを組み合わせる
- Bulk SDK import は `src/adapters/bulk/` に閉じる
- Hyperliquid SDK import は `src/lib/hyperliquid/` と `src/adapters/hyperliquid/` に閉じる
- infrastructure は domain ports と storage library に依存する
- secret env は `src/env.ts` と config expansion 以外で直接読まない

## テスト構成

- `tests/domain/`
  - strategy、quote engine、analytics の pure unit test
- `tests/application/`
  - DI、bot loop、use case の orchestration test
- `tests/adapters/`
  - Bulk adapter と venue payload normalization の unit test
- `tests/infrastructure/`
  - SQLite/Postgres repository integration test
- `tests/e2e/`
  - public feed を使う smoke test

Bulk main path を変更した場合は、少なくとも `bun run lint` と `bun run test` を実行する。
public feed 依存の確認が必要な場合だけ `bun run test:e2e:paper` を追加する。
