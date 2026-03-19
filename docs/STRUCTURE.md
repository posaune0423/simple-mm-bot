# STRUCTURE

## 目的

この文書は `simple-mm-bot` のリポジトリ構成と各ディレクトリの責務を定義する。
現時点のリポジトリはまだ bootstrap 段階のため、この文書は「現状の実装一覧」ではなく「これから実装を進めるための目標構成」を示す。

## 現状

現在のトップレベルは最小構成であり、以下のみが存在する。

- Bun TypeScript プロジェクト
- `index.ts` エントリポイント
- `vite.config.ts` による tooling
- `docs/` と task memory

まだ `src/`、`config/`、`tests/` は作られていない。
そのため、この文書で定義する構成を今後の実装の正とする。

## 目標ディレクトリ構成

```text
simple-mm-bot/
├── src/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── Quote.ts
│   │   │   ├── Position.ts
│   │   │   ├── Fill.ts
│   │   │   └── Report.ts
│   │   ├── ports/
│   │   │   ├── IMarketFeed.ts
│   │   │   ├── IOrderGateway.ts
│   │   │   ├── IPositionRepository.ts
│   │   │   ├── ITradeRepository.ts
│   │   │   ├── IReportRepository.ts
│   │   │   └── IOhlcvRepository.ts
│   │   ├── strategy/
│   │   │   ├── IQuotingStrategy.ts
│   │   │   └── avellaneda-stoikov/
│   │   │       ├── AvellanedaStoikovStrategy.ts
│   │   │       └── AvellanedaStoikovParams.ts
│   │   ├── QuoteEngine.ts
│   │   ├── Analytics.ts
│   │   ├── FairPriceCalculator.ts
│   │   └── VolatilityEstimator.ts
│   ├── application/
│   │   ├── usecases/
│   │   │   ├── RefreshQuotesUseCase.ts
│   │   │   ├── RecordFillUseCase.ts
│   │   │   ├── GuardRiskUseCase.ts
│   │   │   ├── ReduceInventoryUseCase.ts
│   │   │   └── BuildReportUseCase.ts
│   │   ├── Bot.ts
│   │   └── di.ts
│   ├── adapters/
│   │   ├── bullet/
│   │   │   ├── BulletMarketFeed.ts
│   │   │   ├── BulletOrderGateway.ts
│   │   │   └── BulletOhlcvFetcher.ts
│   │   ├── hyperliquid/
│   │   │   ├── HyperliquidMarketFeed.ts
│   │   │   ├── HyperliquidOrderGateway.ts
│   │   │   └── HyperliquidOhlcvFetcher.ts
│   │   └── paper/
│   │       ├── PaperOrderGateway.ts
│   │       └── HistoricalMarketFeed.ts
│   ├── infrastructure/
│   │   └── db/
│   │       ├── sqlite/
│   │       │   ├── client.ts
│   │       │   ├── schema.ts
│   │       │   ├── migrations/
│   │       │   └── repository/
│   │       └── postgres/
│   │           ├── client.ts
│   │           ├── schema.ts
│   │           ├── migrations/
│   │           └── repository/
│   └── main.ts
├── config/
│   ├── config.yml
│   ├── config.paper.yml
│   ├── config.replay.yml
│   └── config.example.yml
├── data/
│   └── mmbot.db
├── tests/
│   ├── domain/
│   ├── application/
│   └── infrastructure/
├── docs/
│   ├── PRD.md
│   ├── TECH.md
│   ├── STRUCTURE.md
│   └── specs/
│       └── init.md
├── drizzle.config.ts
├── Dockerfile
├── package.json
└── tsconfig.json
```

## レイヤーごとの責務

### `src/domain/`

純粋なビジネスロジックを置く。

- venue SDK を import しない
- DB 実装を import しない
- env を直接読まない
- infrastructure に依存しない

この層は entity、port、strategy、quote 計算、analytics を持つ。

### `src/application/`

use case と bot runtime の実行順を担う。

- domain service を組み合わせる
- tick loop を持つ
- `di.ts` を通じて依存解決を司る
- venue protocol や SQL を書かない

### `src/adapters/`

venue / mode ごとの具体実装を置く。

- 外部 payload を domain model に変換する
- venue ごとの order semantics を吸収する
- paper / replay 実装を持つ

Bullet と Hyperliquid の違いをここに閉じ込める。

### `src/infrastructure/`

DB など外部システムの詳細を置く。

- DB client
- schema
- migrations
- repository 実装

storage 都合を domain に漏らさないことを前提にする。

## ディレクトリ規約

### `entities/`

entity は小さく、serializable で、adapter の生 payload を直接持ち込まない。

### `ports/`

差し替え可能性がある責務は、まず port に切ることを検討する。
venue、mode、DB の違いを吸収する境界は基本的にここに置く。

### `strategy/`

strategy ごとに独立したディレクトリを切る。
初期戦略は `avellaneda-stoikov/` とする。

### `usecases/`

1 use case = 1 operational responsibility を原則にする。
quoting、risk、fills、reporting を 1 クラスに混ぜない。

## エントリポイントと依存解決

- `src/main.ts`
  - 起動専用に保つ
- `src/application/di.ts`
  - 具体実装の組み立てを一元化する
- config / env parsing
  - 起動時に済ませ、typed config として下流へ渡す

## 設定ファイル構成

`config/` には commit 可能な設定ファイルだけを置く。

- `config.yml`
  - 基本設定
- `config.paper.yml`
  - paper 向け既定値
- `config.replay.yml`
  - replay 向け既定値
- `config.example.yml`
  - 安全なテンプレート

secret は config に直書きせず、環境変数で注入する。

## DB 構成

2 つの backend を同じ責務分割で持つ。

- `sqlite/`
  - local / 軽量運用向け
- `postgres/`
  - production 向け

各 backend 配下には以下を揃える。

- `client.ts`
- `schema.ts`
- `migrations/`
- `repository/`

repository 名は backend と port 名に対応させる。
例: `SqliteTradeRepository`, `PostgresReportRepository`

## テスト構成

### `tests/domain/`

strategy、quote engine、analytics の pure unit test を置く。

### `tests/application/`

port を mock した use case test を置く。
副作用の順序と分岐を検証する層とする。

### `tests/infrastructure/`

SQLite など実ストレージを使う integration test を置く。

paper E2E は必要になった段階で専用ディレクトリを追加してよい。

## 依存ルール

以下を構造上の制約とする。

- domain は application / adapters / infrastructure を import しない
- application は domain のみを import する
- adapters は domain ports と共通型を import する
- infrastructure は domain ports と storage library を import する
- 具体実装の全体像を知ってよいのは `main.ts` と `di.ts` のみ

## 実装順の推奨

実装は以下の順で進める。

1. `domain/`
2. `application/usecases/`
3. `adapters/paper/` と最小の in-memory repository
4. `infrastructure/db/sqlite/`
5. `adapters/bullet/`
6. replay 経路
7. `adapters/hyperliquid/`

この順序により、外部接続に入る前に core logic を test で固められる。
