# mmbot 開発要件定義書

> Bullet Perp DEX 向け Market Making Bot

| 項目       | 内容                                      |
| ---------- | ----------------------------------------- |
| バージョン | 1.0.0                                     |
| 実行環境   | Bun (TypeScript)                          |
| デプロイ先 | Railway (Docker)                          |
| 対象 venue | Bullet (primary), Hyperliquid (secondary) |

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [フォルダ構成](#3-フォルダ構成)
4. [Domain 層](#4-domain-層)
5. [Application 層](#5-application-層)
6. [Adapters 層](#6-adapters-層)
7. [Infrastructure 層](#7-infrastructure-層)
8. [設定管理](#8-設定管理)
9. [Bullet 固有設計](#9-bullet-固有設計)
10. [テスト方針](#10-テスト方針)
11. [デプロイ](#11-デプロイ)
12. [将来の拡張パス](#12-将来の拡張パス)

---

## 1. プロジェクト概要

Bullet Perp DEX を主要 venue とした Market Making Bot。Avellaneda-Stoikov モデルを中核戦略として採用する。Clean Architecture に基づき、venue・DB・実行モードを疎結合に設計する。

### 目標

- Bullet ETH-PERP における passive maker として継続的にスプレッドを取得する
- live / paper / replay の 3 モードを単一コードベースで動作させる
- venue・DB・strategy を設定変更のみで差し替え可能にする
- backtest (replay) で過去データを用いた戦略検証を行えるようにする

### 実行モード

| モード   | MarketFeed           | OrderGateway       | 用途                      |
| -------- | -------------------- | ------------------ | ------------------------- |
| `live`   | BulletMarketFeed     | BulletOrderGateway | 本番取引                  |
| `paper`  | BulletMarketFeed     | PaperOrderGateway  | live feed を見て約定はsim |
| `replay` | HistoricalMarketFeed | PaperOrderGateway  | 過去データで戦略検証      |

---

## 2. アーキテクチャ

Clean Architecture に基づく4層構造。依存の方向は常に内側 (domain) に向かう。

| 層             | ディレクトリ          | 責務                                               | 外部依存                                 |
| -------------- | --------------------- | -------------------------------------------------- | ---------------------------------------- |
| Domain         | `src/domain/`         | 純粋なビジネスロジック。エンティティ・ポート・戦略 | なし                                     |
| Application    | `src/application/`    | UseCase のオーケストレーション。Bot・DI            | domain のみ                              |
| Adapters       | `src/adapters/`       | venue との変換層。port の実装                      | domain/ports のみ                        |
| Infrastructure | `src/infrastructure/` | DB 接続・schema・Repository 実装                   | domain/ports + drizzle + bun:sqlite / pg |

### 依存の方向

```
main.ts
  └─ application/di.ts  (DIContainer)
       ├─ application/Bot.ts
       │    └─ application/usecases/
       │         └─ domain/
       ├─ adapters/  (venue adapter)
       └─ infrastructure/db/  (repository)
```

---

## 3. フォルダ構成

```
mmbot/
├── src/
│   ├── domain/                              # 外部依存ゼロ。pure TS
│   │   ├── entities/
│   │   │   ├── Quote.ts                     # { bid, ask, bidSize, askSize, policy }
│   │   │   ├── Position.ts                  # { qty, avgEntry, unrealizedPnl }
│   │   │   ├── Fill.ts                      # 約定イベント
│   │   │   └── Report.ts                    # metrics, equityCurve, fillAnalysis
│   │   ├── ports/                           # interfaces のみ
│   │   │   ├── IMarketFeed.ts
│   │   │   ├── IOrderGateway.ts
│   │   │   ├── IPositionRepository.ts
│   │   │   ├── ITradeRepository.ts
│   │   │   ├── IReportRepository.ts
│   │   │   └── IOhlcvRepository.ts
│   │   ├── strategy/
│   │   │   ├── IQuotingStrategy.ts          # 将来拡張口
│   │   │   └── avellaneda-stoikov/
│   │   │       ├── AvellanedaStoikovStrategy.ts
│   │   │       └── AvellanedaStoikovParams.ts   # zod schema + 型
│   │   ├── QuoteEngine.ts                   # strategy を1つ受け取る
│   │   ├── Analytics.ts                     # fill -> metrics
│   │   ├── FairPriceCalculator.ts           # mark*0.6 + micro*0.4
│   │   └── VolatilityEstimator.ts           # EWMA sigma
│   │
│   ├── application/                         # orchestration。domain のみに依存
│   │   ├── usecases/
│   │   │   ├── RefreshQuotesUseCase.ts
│   │   │   ├── RecordFillUseCase.ts
│   │   │   ├── GuardRiskUseCase.ts
│   │   │   ├── ReduceInventoryUseCase.ts
│   │   │   └── BuildReportUseCase.ts
│   │   ├── Bot.ts                           # tick loop。mode を知らない
│   │   └── di.ts                            # DIContainer
│   │
│   ├── adapters/                            # port の実装。venue との変換層
│   │   ├── bullet/
│   │   │   ├── BulletMarketFeed.ts          # IMarketFeed
│   │   │   ├── BulletOrderGateway.ts        # IOrderGateway
│   │   │   └── BulletOhlcvFetcher.ts        # 外部API → Ohlcv
│   │   ├── hyperliquid/
│   │   │   ├── HyperliquidMarketFeed.ts
│   │   │   ├── HyperliquidOrderGateway.ts
│   │   │   └── HyperliquidOhlcvFetcher.ts
│   │   └── paper/                           # venue 非依存の sim
│   │       ├── PaperOrderGateway.ts         # IOrderGateway。fill simulation
│   │       └── HistoricalMarketFeed.ts      # IMarketFeed。DB cache + API fetch
│   │
│   ├── infrastructure/                      # 外部システムの詳細
│   │   └── db/
│   │       ├── sqlite/
│   │       │   ├── client.ts                # bun:sqlite + drizzle
│   │       │   ├── schema.ts                # drizzle-orm/sqlite-core
│   │       │   ├── migrations/
│   │       │   │   ├── 0001_create_fills.sql
│   │       │   │   ├── 0002_create_reports.sql
│   │       │   │   └── 0003_create_ohlcv.sql
│   │       │   └── repository/
│   │       │       ├── SqliteTradeRepository.ts    # ITradeRepository
│   │       │       ├── SqliteReportRepository.ts   # IReportRepository
│   │       │       └── SqliteOhlcvRepository.ts    # IOhlcvRepository
│   │       └── postgres/                    # 将来の差し替え先
│   │           ├── client.ts                # postgres.js + drizzle
│   │           ├── schema.ts                # drizzle-orm/pg-core
│   │           ├── migrations/
│   │           │   ├── 0001_create_fills.sql
│   │           │   ├── 0002_create_reports.sql
│   │           │   └── 0003_create_ohlcv.sql
│   │           └── repository/
│   │               ├── PostgresTradeRepository.ts
│   │               ├── PostgresReportRepository.ts
│   │               └── PostgresOhlcvRepository.ts
│   │
│   └── main.ts                              # エントリポイント。3行で完結
│
├── config/
│   ├── config.yml                           # 本番 params
│   ├── config.paper.yml                     # paper mode 用
│   ├── config.replay.yml                    # replay mode 用
│   └── config.example.yml                   # git 管理テンプレ
│
├── data/
│   └── mmbot.db                             # sqlite ファイル (gitignore)
│
├── tests/
│   ├── domain/                              # 外部依存ゼロ。純粋 unit test
│   │   ├── QuoteEngine.test.ts
│   │   ├── AvellanedaStoikovStrategy.test.ts
│   │   └── Analytics.test.ts
│   ├── application/                         # mock adapter で usecase test
│   │   ├── RefreshQuotesUseCase.test.ts
│   │   └── BuildReportUseCase.test.ts
│   └── infrastructure/                      # 実DB を使った integration test
│       └── SqliteTradeRepository.test.ts
│
├── .env                                     # secrets (gitignore)
├── .env.example
├── drizzle.config.ts                        # sqlite / postgres を env で切替
├── bunfig.toml
├── tsconfig.json
├── Dockerfile
└── package.json
```

---

## 4. Domain 層

### 4.1 エンティティ

| ファイル      | 型                                                                 | 説明                                                                                  |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `Quote.ts`    | `{ bid, ask, bidSize, askSize, policy }`                           | QuoteEngine の出力。`OrderPolicy` (PostOnly \| PostOnlySlide \| PostOnlyFront) を含む |
| `Position.ts` | `{ qty, avgEntry, unrealizedPnl }`                                 | 現在のポジション状態                                                                  |
| `Fill.ts`     | `{ id, venue, market, side, price, qty, fee, tradePnl, filledAt }` | 約定イベント。Analytics の入力                                                        |
| `Report.ts`   | `{ metrics, equityCurve, fillAnalysis }`                           | backtest / live の分析結果                                                            |

### 4.2 Ports

| Interface             | 主なメソッド                                       | 実装クラス                                                     |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `IMarketFeed`         | `getSnapshot()`, `subscribe()`                     | BulletMarketFeed, HyperliquidMarketFeed, HistoricalMarketFeed  |
| `IOrderGateway`       | `place(order)`, `cancel(id)`, `cancelAll()`        | BulletOrderGateway, HyperliquidOrderGateway, PaperOrderGateway |
| `IPositionRepository` | `get()`, `update(fill)`                            | InMemoryPositionRepository                                     |
| `ITradeRepository`    | `save(fill)`, `findByRange(from, to)`, `findAll()` | SqliteTradeRepository, PostgresTradeRepository                 |
| `IReportRepository`   | `save(report)`, `findAll()`                        | SqliteReportRepository, PostgresReportRepository               |
| `IOhlcvRepository`    | `findByRange(...)`, `saveMany(ohlcv[])`            | SqliteOhlcvRepository, PostgresOhlcvRepository                 |

### 4.3 Strategy

#### IQuotingStrategy

全戦略が実装すべき interface。将来の戦略追加時の拡張口として機能する。

```typescript
interface IQuotingStrategy {
  readonly name: string;
  computeQuote(ctx: QuoteContext, fair: number): QuoteResult;
}
```

#### AvellanedaStoikovStrategy

主戦略。Avellaneda-Stoikov モデルに基づく最適スプレッド計算。`gamma=0` で Fixed Spread として動作するため、別クラスは不要。

#### AvellanedaStoikovParams

| パラメータ | 型                 | 説明                                                        | 推奨値 |
| ---------- | ------------------ | ----------------------------------------------------------- | ------ |
| `gamma`    | number (0.001-0.5) | リスク回避係数。大きいほどスプレッド広め。0 で Fixed Spread | 0.02   |
| `kappa`    | number (> 0)       | Fill intensity 推定値。注文の埋まりやすさ                   | 1.5    |
| `kInv`     | number (0-2)       | Inventory skew 係数                                         | 0.3    |

params は `AvellanedaStoikovParams.ts` 内の zod schema で定義・バリデーションする。config.yml から読み込む際も同 schema を通す。

### 4.4 QuoteEngine

strategy を 1 つ受け取り、FairPriceCalculator + VolatilityEstimator を使って QuoteResult を生成する。モードも venue も知らない。

```typescript
class QuoteEngine {
  constructor(
    private readonly strategy: IQuotingStrategy,
    private readonly fairCalc: FairPriceCalculator,
    private readonly volEst: VolatilityEstimator,
    private readonly config: QuoteEngineConfig,
  ) {}

  compute(raw: RawMarketInput): QuoteResult;
}
```

### 4.5 Analytics

Fill イベントを受け取り metrics を計算するドメインサービス。

| 指標                       | 説明                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `netPnl`                   | tradePnl - fee の累計                                                                      |
| `tradePnl`                 | fill 時点の mark price との差から計算                                                      |
| `markout5s` / `markout30s` | fill 後 5秒・30秒の mark price 変化。adverse selection の検出指標。マイナスなら toxic flow |
| `maxDrawdown`              | 累積 PnL のピークからの最大下落幅                                                          |
| `sharpe`                   | リターンの平均 / 標準偏差 × sqrt(年率換算)                                                 |
| `fillRate`                 | quote に対して約定した割合                                                                 |

---

## 5. Application 層

### 5.1 Bot

tick loop を持つ。mode・venue を一切知らない。注入された UseCases を順番に実行するだけ。

```typescript
class Bot {
  constructor(private readonly useCases: UseCases) {}
  async start(): Promise<void>;
  stop(): void;
}
```

tick 内の実行順:

```
1. GuardRiskUseCase.execute()
   → EMERGENCY_STOP : cancelAll() + bot.stop()
   → PAUSE_QUOTING  : skip
   → OK             : continue

2. RefreshQuotesUseCase.execute()
   → cancelAll → QuoteEngine.compute() → place bid/ask

3. ReduceInventoryUseCase.executeIfNeeded()
   → inventory が閾値超過なら reduce-only IOC
```

### 5.2 UseCases

| UseCase                  | 責務                                                             | 依存 port                                       |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------------- |
| `RefreshQuotesUseCase`   | QuoteEngine を呼び出し、cancel → place を実行                    | IMarketFeed, IOrderGateway, IPositionRepository |
| `RecordFillUseCase`      | fill イベントを repository に保存。PositionRepository を更新     | ITradeRepository, IPositionRepository           |
| `GuardRiskUseCase`       | margin ratio を取得し EMERGENCY_STOP / PAUSE_QUOTING / OK を返す | IMarketFeed, IOrderGateway                      |
| `ReduceInventoryUseCase` | inventory が閾値を超えたら reduce-only IOC を発行                | IOrderGateway, IPositionRepository              |
| `BuildReportUseCase`     | fills から Report を生成・保存                                   | ITradeRepository, IReportRepository             |

### 5.3 DIContainer (di.ts)

venue × mode の唯一の解決場所。

```typescript
class DIContainer {
  constructor(private readonly config: AppConfig) {}
  async buildBot(): Promise<Bot>;
}
```

adapter 解決ロジック:

```
venue: bullet  × mode: live    → BulletMarketFeed    + BulletOrderGateway
venue: bullet  × mode: paper   → BulletMarketFeed    + PaperOrderGateway
venue: bullet  × mode: replay  → HistoricalMarketFeed + PaperOrderGateway

venue: hyperliquid × mode: live   → HyperliquidMarketFeed + HyperliquidOrderGateway
venue: hyperliquid × mode: paper  → HyperliquidMarketFeed + PaperOrderGateway
venue: hyperliquid × mode: replay → HistoricalMarketFeed  + PaperOrderGateway
```

repository 解決ロジック:

```
DATABASE_URL が設定されている → PostgresTradeRepository, PostgresReportRepository
DATABASE_URL が未設定 (default) → SqliteTradeRepository, SqliteReportRepository
```

---

## 6. Adapters 層

### 6.1 bullet/

| ファイル                | 実装 port       | 説明                                                                   |
| ----------------------- | --------------- | ---------------------------------------------------------------------- |
| `BulletMarketFeed.ts`   | `IMarketFeed`   | WebSocket で orderbook / mark price / funding rate を subscribe        |
| `BulletOrderGateway.ts` | `IOrderGateway` | PostOnly / PostOnlySlide / PostOnlyFront の3種 order policy をサポート |
| `BulletOhlcvFetcher.ts` | `IOhlcvFetcher` | REST API で OHLCV を取得。HistoricalMarketFeed が replay 時に利用      |

### 6.2 hyperliquid/

| ファイル                     | 実装 port       | 説明                                   |
| ---------------------------- | --------------- | -------------------------------------- |
| `HyperliquidMarketFeed.ts`   | `IMarketFeed`   | WebSocket で L2 orderbook を subscribe |
| `HyperliquidOrderGateway.ts` | `IOrderGateway` | ALO (GTX) / GTC / IOC をサポート       |
| `HyperliquidOhlcvFetcher.ts` | `IOhlcvFetcher` | REST API で OHLCV を取得               |

### 6.3 paper/

| ファイル                  | 実装 port       | 説明                                                                                                         |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `PaperOrderGateway.ts`    | `IOrderGateway` | 注文を実際には送信せず fill をシミュレート。bid/ask スプレッドと取引量で約定判定                             |
| `HistoricalMarketFeed.ts` | `IMarketFeed`   | 指定期間の OHLCV を DB から取得。なければ OhlcvFetcher で fetch して cache。任意の timeframe・期間を指定可能 |

#### HistoricalMarketFeed の動作フロー

```
run(range: { from, to, market, timeframe })
  1. OhlcvRepository.findByRange() で DB 確認
  2. データが不足していれば OhlcvFetcher.fetch() で外部 API から取得
  3. 取得したデータを OhlcvRepository.saveMany() で cache
  4. candle を順番に replay して MarketSnapshot を yield
```

---

## 7. Infrastructure 層

### 7.1 DB 切り替え

`DATABASE_URL` 環境変数の有無で自動切り替え。Railway に Postgres アドオンを追加すれば `DATABASE_URL` が自動注入される。

| 条件                              | 使用 DB    | client                               |
| --------------------------------- | ---------- | ------------------------------------ |
| `DATABASE_URL` が設定されている   | PostgreSQL | postgres.js + drizzle-orm/pg-core    |
| `DATABASE_URL` が未設定 (default) | SQLite     | bun:sqlite + drizzle-orm/sqlite-core |

### 7.2 Schema

| テーブル  | 主なカラム                                                                           | 用途                                    |
| --------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| `fills`   | id, venue, market, side, price, qty, fee, trade_pnl, filled_at                       | 約定履歴。PnL 計算・backtest の原データ |
| `reports` | id, mode, venue, period_start, period_end, net_pnl, markout_5s, max_drawdown, sharpe | backtest / live の集計結果              |
| `ohlcv`   | market, ts, open, high, low, close, volume (PK: market + ts)                         | backtest feed のキャッシュ              |

### 7.3 Drizzle 設定

```typescript
// drizzle.config.ts
export default defineConfig(
  process.env.DATABASE_URL
    ? {
        dialect: "postgresql",
        schema: "./src/infrastructure/db/postgres/schema.ts",
        out: "./src/infrastructure/db/postgres/migrations",
        dbCredentials: { url: process.env.DATABASE_URL },
      }
    : {
        dialect: "sqlite",
        schema: "./src/infrastructure/db/sqlite/schema.ts",
        out: "./src/infrastructure/db/sqlite/migrations",
        dbCredentials: { url: process.env.DB_PATH ?? "data/mmbot.db" },
      },
);
```

---

## 8. 設定管理

### 8.1 config.yml

```yaml
mode: live # live | paper | replay
venue: bullet # bullet | hyperliquid

connections:
  bullet:
    wsUrl: ${BULLET_WS_URL}
    apiKey: ${BULLET_API_KEY}
    market: ETH-PERP
  hyperliquid:
    wsUrl: ${HL_WS_URL}
    apiKey: ${HL_API_KEY}
    market: ETH

quoteEngine:
  markWeight: 0.6 # mark price の重み (Bullet 推奨)
  inventoryScale: 0.05 # tanh 正規化のスケール
  timeHorizonSec: 30 # A-S の T
  slideMarginThreshold: 0.12 # margin 近傍で PostOnlySlide に切替
  sizing:
    positionSize: 0.01 # 1注文あたりの基本サイズ
    budgetUsd: 100 # 1注文あたりの予算上限。size は budget/fairPrice でも上限を掛ける
  strategy:
    type: avellaneda-stoikov
    params:
      gamma: 0.02
      kappa: 1.5
      kInv: 0.3

risk:
  imrBuffer: 0.15 # IMR 近傍で quoting 停止
  mmrBuffer: 0.08 # MMR 近傍で emergency cancel

bot:
  intervalMs: 500

# replay モード時のみ使用
replay:
  market: ETH-PERP
  timeframe: 1m
  from: "2024-01-01"
  to: "2024-03-31"
```

### 8.2 環境変数

| 変数名              | 説明                                                | 必須            |
| ------------------- | --------------------------------------------------- | --------------- |
| `BULLET_WS_URL`     | Bullet WebSocket エンドポイント                     | live / paper 時 |
| `BULLET_API_KEY`    | Bullet API キー                                     | live / paper 時 |
| `BULLET_API_SECRET` | Bullet API シークレット                             | live / paper 時 |
| `HL_WS_URL`         | Hyperliquid WebSocket エンドポイント                | HL 使用時       |
| `HL_API_KEY`        | Hyperliquid API キー                                | HL 使用時       |
| `DATABASE_URL`      | PostgreSQL 接続 URL。未設定なら SQLite を使用       | 任意            |
| `DB_PATH`           | SQLite ファイルパス。default: `data/mmbot.db`       | 任意            |
| `MODE`              | 実行モード。config.yml の mode を上書き             | 任意            |
| `CONFIG_PATH`       | config ファイルのパス。default: `config/config.yml` | 任意            |

---

## 9. Bullet 固有設計

### 9.1 Order Policy

Bullet は3種の Post-Only 注文をサポートする。`BulletOrderGateway` がこれらを `IOrderGateway` に抽象化する。

| Policy          | 動作                                   | 使用場面                        |
| --------------- | -------------------------------------- | ------------------------------- |
| `PostOnly`      | クロスしそうならキャンセル             | 通常時 (default)                |
| `PostOnlySlide` | クロスしそうなら best price にスライド | margin 近傍・高 vol 時          |
| `PostOnlyFront` | best price の1ティック前に置く         | queue priority を強く取りたい時 |

margin ratio が `slideMarginThreshold` を下回った場合、QuoteEngine が自動で policy を `PostOnlySlide` に切り替える。

### 9.2 Fair Price 計算

Bullet の mark price は margin / liquidation / unrealized PnL の基準となるため、local mid price だけでなく mark price を混合する。

```
fair = markWeight * markPrice + (1 - markWeight) * microprice
// default: 0.6 * mark + 0.4 * microprice
```

### 9.3 リスク管理

Bullet は unified cross margin であり、IMR 割れで risk-increasing orders が force cancel、MMR 割れで全注文キャンセル + 成行清算となる。`GuardRiskUseCase` でこれを事前に検出して対処する。

| 状態             | 条件                                 | 対処                          |
| ---------------- | ------------------------------------ | ----------------------------- |
| `OK`             | marginRatio >= imrBuffer (0.15)      | 通常 quoting                  |
| `PAUSE_QUOTING`  | mmrBuffer <= marginRatio < imrBuffer | 新規 quote 停止。既存注文維持 |
| `EMERGENCY_STOP` | marginRatio < mmrBuffer (0.08)       | cancelAll() + Bot 停止        |

---

## 10. テスト方針

| テスト種別  | 対象                         | 方針                                                | 外部依存   |
| ----------- | ---------------------------- | --------------------------------------------------- | ---------- |
| Unit        | `domain/`                    | 純粋な TypeScript。mock 不要                        | なし       |
| Unit        | `application/usecases/`      | port を mock して UseCase を検証                    | mock のみ  |
| Integration | `infrastructure/repository/` | 実際の SQLite を使って Repository を検証            | bun:sqlite |
| E2E (paper) | 全層                         | `MODE=paper` で起動して実際の feed に対して動作確認 | Bullet WS  |

### 主なテストケース

**`domain/QuoteEngine.test.ts`**

- `gamma=0` の時にスプレッドが固定値になること
- `inventory > 0` の時に bid が下方スキューされること
- sigma が上昇するとスプレッドが広がること

**`domain/AvellanedaStoikovStrategy.test.ts`**

- A-S 公式に基づく bid/ask 計算の数値検証
- `kInv=0` の時に symmetric quote になること

**`application/RefreshQuotesUseCase.test.ts`**

- GuardRisk が `EMERGENCY_STOP` の時に quote が送信されないこと
- `cancelAll → place` の順で呼ばれること

**`application/BuildReportUseCase.test.ts`**

- fills から `netPnl`, `maxDrawdown`, `sharpe` が正しく計算されること
- `markout5s` がマイナスの時に adverse selection が検出されること

---

## 11. デプロイ

### Dockerfile

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
ENV MODE=live
ENV CONFIG_PATH=config/config.yml
CMD ["bun", "src/main.ts"]
```

### Railway 設定

| 設定項目       | 値                                                        |
| -------------- | --------------------------------------------------------- |
| ビルド方法     | Dockerfile                                                |
| モード切り替え | Railway 環境変数 `MODE=live\|paper\|replay`               |
| DB (default)   | SQLite (`data/mmbot.db` はボリュームマウント推奨)         |
| DB (本番推奨)  | Railway PostgreSQL アドオン追加 → `DATABASE_URL` 自動注入 |

### 起動コマンド

```bash
# 実行
MODE=live    bun src/main.ts
MODE=paper   bun src/main.ts
MODE=replay  bun src/main.ts

# DB migration
bun drizzle-kit generate
bun drizzle-kit migrate

# テスト
bun test
```

---

## 12. 将来の拡張パス

| 拡張内容                                 | 対応方法                                                            | 影響範囲               |
| ---------------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| venue 追加 (Drift 等)                    | `adapters/` に新ディレクトリ追加 → `di.ts` に case を追加           | adapters/ + di.ts のみ |
| strategy 追加 (Cartea-Jaimungal)         | `domain/strategy/` に新ディレクトリ追加 → `IQuotingStrategy` を実装 | domain/ のみ           |
| PostgreSQL への移行                      | `DATABASE_URL` 環境変数を設定するだけ                               | 設定変更のみ           |
| multi-level quoting                      | `domain/strategy/` に `MultiLevelStrategy` を追加                   | domain/ のみ           |
| XEMM                                     | Bot 構成ごと別プロジェクト。domain/ は共有可能                      | 別プロジェクト         |
| Toxic flow 検出 (Cartea-Jaimungal-Ricci) | markout 観察後、Analytics に adverseSelection を追加                | domain/ + Analytics    |
