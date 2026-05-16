# PRD

## 目的

この文書は `simple-mm-bot` のプロダクト要件を定義する。
対象は Perp DEX 向けの Market Making Bot であり、当面の主対象 venue は **Bulk Trade** とする。

Bullet は現在の対応対象ではない。

## プロダクト概要

`simple-mm-bot` は Bun + TypeScript で実装するマーケットメイキング bot である。
継続的に bid / ask の両建て quote を提示し、passive maker としてスプレッド獲得を目指す。

中核戦略には Avellaneda-Stoikov モデルを採用する。
ただし、このプロダクトの本質は単なる戦略実装ではなく、venue、実行モード、記録 worker、TimescaleDB schema を分離した運用基盤を持つことにある。

初期の実運用ターゲットは Bulk Trade の `BTC-USD` とする。

Bulk Trade には公式 TypeScript SDK がないため、Bulk API を wrap した `bulk-ts-sdk` を使用する。
`bulk-ts-sdk` はこの bot から直接 API payload を組み立てないための venue SDK 境界であり、Bulk 固有の HTTP/WS/order/account API の詳細を adapter 層へ閉じ込める。

## 目標

- Bulk Trade `BTC-USD` で継続的に quote できること
- `live` と `paper` を同一コードベースで運用できること
- venue と strategy を設定変更中心で差し替えられること
- Bulk live order placement では `BULK_PRIVATE_KEY` のみを secret env として要求すること
- venue market data を bot runtime とは別 worker で TimescaleDB に保存できること
- 将来的な venue 追加や strategy 追加に耐える構造を維持すること

## 非目標

初期版では以下を対象外とする。

- Bullet venue 対応
- multi-level quoting
- 複数 venue をまたぐヘッジや XEMM
- 複数 strategy のポートフォリオ管理
- 専用 UI やダッシュボードの構築
- markout 分析を超える高度な toxic flow モデル

## 想定ユーザー

- `live` モードで bot を運用するオペレーター
- `paper` モードで戦略やパラメータを調整する開発者
- PnL、drawdown、fill quality、adverse selection を検証するリサーチ担当

## 主要ユースケース

1. Bulk Trade に対して `live` モードで実注文を出し、maker として稼働する
2. 同じロジックを Bulk `paper` モードで動かし、live feed に対してシミュレーション検証する
3. Bulk historical OHLCV を使って backtest / smoke validation を実行する
4. venue、mode、strategy params を config の変更だけで切り替える
5. venue market fact と bot execution fact を分けて保存し、view で後から markout 分析できるようにする

## 実行モード

| モード     | 主対象 venue | MarketFeed             | OrderGateway | 用途     |
| ---------- | ------------ | ---------------------- | ------------ | -------- |
| `live`     | Bulk Trade   | Bulk live feed         | Bulk gateway | 本番取引 |
| `paper`    | Bulk Trade   | Bulk live feed         | sim gateway  | 事前検証 |
| `backtest` | Bulk Trade   | historical replay feed | sim gateway  | 過去検証 |

## プロダクト要件

### Quoting

- bot は fair price と volatility estimate に基づいて、継続的に二方向 quote を生成できること
- デフォルト戦略は Avellaneda-Stoikov であること
- `gamma = 0` のとき fixed spread 相当の挙動を別 strategy を作らずに実現できること
- quote 出力には価格、サイズ、order policy が含まれること
- Bulk の初期 `defaultTimeInForce` は `GTC` とすること

### Risk Control

- quote 更新前に margin 状態を確認すること
- Bulk account id は `bulk-ts-sdk` の client から導出すること
- paper mode では `BULK_PRIVATE_KEY` なしで動作し、account id がない場合の `marginRatio` は `null` とすること
- 緊急域では全注文キャンセルと bot 停止を実行できること
- 在庫が閾値を超えた場合、inventory 圧縮のための reduce-only 処理を独立して実行できること

### Venue Flexibility

- Bulk Trade を当面の primary venue とすること
- Hyperliquid は backtest と既存 adapter の互換用途として維持すること
- Bullet は現在の対応対象に含めないこと
- venue 固有の order semantics は adapter 層に閉じ込めること

### Persistence and Analysis

- `market_data_order_book_snapshots`, `market_data_trades`, `market_data_tickers` を venue market fact として保存すること
- `bot_runs`, `bot_market_observations`, `bot_quote_decisions`, `bot_orders`, `bot_fills` を bot execution fact として保存すること
- 集計結果は table ではなく view で計算し、`analytics_quote_markouts` と `analytics_fill_markouts` を最小分析 surface にすること
- market-data recorder は bot data を書かないこと

## 成功条件

- Bulk `paper` と `live` が設定と DI の切り替えで解決される
- Bulk `paper` は secret なしで起動できる
- Bulk `live` は `BULK_PRIVATE_KEY` がない場合に明示的に失敗する
- Bulk `backtest` は secret なしで historical replay と sim gateway に解決される
- analytics として quote markout と fill markout を SQL view で扱える
- venue 切り替えの影響範囲が adapter / infrastructure / DI に局所化されている

## 初期スコープ

### 対象に含むもの

- Bulk Trade の venue adapter
- `bulk-ts-sdk` を使った Bulk HTTP/WS/order/account API 呼び出し
- `live` / `paper` / 暫定 `backtest` の実行モード
- Bulk historical OHLCV fetcher / backtest path
- Avellaneda-Stoikov strategy とその parameterization
- mark price と microprice を使った fair price 計算
- EWMA による volatility 推定
- quote 更新、fill 記録、risk guard、inventory reduction、metrics fact 記録
- TimescaleDB / PostgreSQL を前提にした保存基盤
- Bulk market data recorder worker
- Drizzle Postgres schema and destructive migration
- Docker / Hetzner VPS でのデプロイ経路

### 初期スコープから外すもの

- Bullet venue 対応
- bot 間の strategy orchestration
- 専用モニタリング UI
- 高度な toxic flow 推定モデル
- multi-venue hedging
- perp 以外の資産クラス対応

## 制約

- ランタイムは Bun + TypeScript
- Database は TimescaleDB / PostgreSQL のみ
- ORM は Drizzle Postgres のみ
- デプロイ先は Hetzner VPS + Docker
- Clean Architecture の依存方向を崩さない
- Bulk API の直接呼び出しは `bulk-ts-sdk` と Bulk adapter 層に閉じ込める
- `live` / `paper` / `backtest` で application 層の振る舞いを揃える

## プロダクト上のリスク

- margin まわりの挙動は venue 依存で、誤ると強制キャンセルや清算リスクに直結する
- `bulk-ts-sdk` は公式 SDK ではなく、この bot のために運用する API wrapper である
- paper fill は live execution quality を完全には再現しない
- backtest 品質は Bulk の OHLCV 粒度と paper fill model に依存する。historical L2 は現行の Bulk SDK/API から取得できない

## 初期リリース条件

- config 駆動で mode / venue を切り替えられる
- Bulk の `paper` / `live` adapter 解決が end-to-end で成立する
- Bulk read-only market data smoke が成立する
- TimescaleDB extension、hypertables、analytics views が migration で作成される
- Bulk market data recorder が bot とは別 process で稼働する
- emergency stop と quoting pause の挙動がテストで検証されている
