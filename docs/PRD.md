# PRD

## 目的

この文書は `simple-mm-bot` のプロダクト要件を定義する。
対象は Perp DEX 向けの Market Making Bot であり、当面の主対象 venue は **Bulk Trade** とする。

Bullet は現在の対応対象ではない。

## プロダクト概要

`simple-mm-bot` は Bun + TypeScript で実装するマーケットメイキング bot である。
継続的に bid / ask の両建て quote を提示し、passive maker としてスプレッド獲得を目指す。

中核戦略には Avellaneda-Stoikov モデルを採用する。
ただし、このプロダクトの本質は単なる戦略実装ではなく、venue、実行モード、保存先 DB を疎結合に切り替えられる運用基盤を持つことにある。

初期の実運用ターゲットは Bulk Trade の `BTC-USD` とする。

Bulk Trade には公式 TypeScript SDK がないため、Bulk API を wrap した `bulk-ts-sdk` を使用する。
`bulk-ts-sdk` はこの bot から直接 API payload を組み立てないための venue SDK 境界であり、Bulk 固有の HTTP/WS/order/account API の詳細を adapter 層へ閉じ込める。

## 目標

- Bulk Trade `BTC-USD` で継続的に quote できること
- `live` と `paper` を同一コードベースで運用できること
- venue、DB、strategy を設定変更中心で差し替えられること
- Bulk live order placement では `BULK_PRIVATE_KEY` のみを secret env として要求すること
- 将来的な venue 追加や strategy 追加に耐える構造を維持すること

## 非目標

初期版では以下を対象外とする。

- Bullet venue 対応
- Bulk backtest / replay
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
3. 一時的に Hyperliquid の historical path を使って backtest / smoke validation を実行する
4. venue、mode、strategy params を config の変更だけで切り替える
5. fills、reports、live / paper / backtest の OHLCV を保存し、後から分析できるようにする

## 実行モード

| モード     | 主対象 venue | MarketFeed             | OrderGateway | 用途           |
| ---------- | ------------ | ---------------------- | ------------ | -------------- |
| `live`     | Bulk Trade   | Bulk live feed         | Bulk gateway | 本番取引       |
| `paper`    | Bulk Trade   | Bulk live feed         | sim gateway  | 事前検証       |
| `backtest` | Hyperliquid  | historical replay feed | sim gateway  | 暫定の過去検証 |

Bulk `backtest` は現時点では未対応であり、`bulk + backtest` は明示的にエラーにする。

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

- fills を保存し、PnL や execution quality の分析に使えること
- reports を保存し、live / paper / backtest の集計結果を残せること
- live / paper では market snapshot を 1m OHLCV に集約して保存できること
- historical OHLCV を cache し、backtest 実行時に再利用できること

## 成功条件

- Bulk `paper` と `live` が設定と DI の切り替えで解決される
- Bulk `paper` は secret なしで起動できる
- Bulk `live` は `BULK_PRIVATE_KEY` がない場合に明示的に失敗する
- Bulk `backtest` は未対応として明示的に失敗する
- analytics として `netPnl`、`tradePnl`、`markout5s`、`markout30s`、`maxDrawdown`、`sharpe`、`fillRate` を扱える
- venue 切り替えと DB 切り替えの影響範囲が adapter / infrastructure / DI に局所化されている

## 初期スコープ

### 対象に含むもの

- Bulk Trade の venue adapter
- `bulk-ts-sdk` を使った Bulk HTTP/WS/order/account API 呼び出し
- `live` / `paper` / 暫定 `backtest` の実行モード
- Avellaneda-Stoikov strategy とその parameterization
- mark price と microprice を使った fair price 計算
- EWMA による volatility 推定
- quote 更新、fill 記録、risk guard、inventory reduction、report 生成
- SQLite を default とする保存基盤
- `DATABASE_URL` による PostgreSQL 切り替え
- Docker / Railway でのデプロイ経路

### 初期スコープから外すもの

- Bullet venue 対応
- Bulk historical data fetcher / backtest path
- bot 間の strategy orchestration
- 専用モニタリング UI
- 高度な toxic flow 推定モデル
- multi-venue hedging
- perp 以外の資産クラス対応

## 制約

- ランタイムは Bun + TypeScript
- デプロイ先は Railway + Docker
- Clean Architecture の依存方向を崩さない
- Bulk API の直接呼び出しは `bulk-ts-sdk` と Bulk adapter 層に閉じ込める
- `live` / `paper` / `backtest` で application 層の振る舞いを揃える

## プロダクト上のリスク

- margin まわりの挙動は venue 依存で、誤ると強制キャンセルや清算リスクに直結する
- `bulk-ts-sdk` は公式 SDK ではなく、この bot のために運用する API wrapper である
- paper fill は live execution quality を完全には再現しない
- backtest 品質は現時点で Hyperliquid historical path に依存する

## 初期リリース条件

- config 駆動で mode / venue を切り替えられる
- Bulk の `paper` / `live` adapter 解決が end-to-end で成立する
- Bulk read-only market data smoke が成立する
- fills から reports を生成できる
- emergency stop と quoting pause の挙動がテストで検証されている
