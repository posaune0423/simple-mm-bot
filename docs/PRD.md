# PRD

## 目的

この文書は `simple-mm-bot` のプロダクト要件を定義する。
何を作るか、誰のためのものか、どこまでを初期スコープに含めるか、どの状態を初期リリース完了とみなすかを明確にする。

対象プロダクトは、Perp DEX 向けの Market Making Bot であり、初期の主対象 venue は Bullet、次点の対応 venue は Hyperliquid とする。

## プロダクト概要

`simple-mm-bot` は Bun + TypeScript で実装するマーケットメイキング bot である。
継続的に bid / ask の両建て quote を提示し、passive maker としてスプレッド獲得を目指す。

中核戦略には Avellaneda-Stoikov モデルを採用する。
ただし、このプロダクトの本質は単なる戦略実装ではなく、venue、実行モード、保存先 DB を疎結合に切り替えられる運用基盤を最初から持つことにある。

初期の実運用ターゲットは Bullet の `ETH-PERP` とする。

## 目標

- Bullet `ETH-PERP` で passive maker として継続的に quote できること
- `live`、`paper`、`replay` の 3 モードを単一コードベースで運用できること
- venue、DB、strategy を設定変更中心で差し替えられること
- 過去データを使った replay 検証を本番導入前の標準フローにできること
- 将来的な venue 追加や strategy 追加に耐える構造を最初から持つこと

## 非目標

初期版では以下を対象外とする。

- multi-level quoting
- 複数 venue をまたぐヘッジや XEMM
- 複数 strategy のポートフォリオ管理
- 専用 UI やダッシュボードの構築
- markout 分析を超える高度な toxic flow モデル

## 想定ユーザー

- `live` モードで bot を運用するオペレーター
- `paper` / `replay` モードで戦略やパラメータを調整する開発者
- PnL、drawdown、fill quality、adverse selection を検証するリサーチ担当

## 主要ユースケース

1. Bullet に対して `live` モードで実注文を出し、post-only maker として稼働する
2. 同じロジックを `paper` モードで動かし、live feed に対してシミュレーション検証する
3. 同じロジックを `replay` モードで動かし、過去データからレポートを生成する
4. venue、mode、strategy params を config の変更だけで切り替える
5. fills、reports、replay 用 OHLCV を保存し、後から分析できるようにする

## 実行モード

| モード   | MarketFeed             | OrderGateway     | 用途            |
| -------- | ---------------------- | ---------------- | --------------- |
| `live`   | venue の live feed     | 実 venue gateway | 本番取引        |
| `paper`  | venue の live feed     | sim gateway      | 事前検証        |
| `replay` | historical replay feed | sim gateway      | backtest / 検証 |

## プロダクト要件

### Quoting

- bot は fair price と volatility estimate に基づいて、継続的に二方向 quote を生成できること
- デフォルト戦略は Avellaneda-Stoikov であること
- `gamma = 0` のとき fixed spread 相当の挙動を別 strategy を作らずに実現できること
- quote 出力には価格、サイズ、order policy が含まれること

### Risk Control

- quote 更新前に margin 状態を必ず確認すること
- 安全域では通常 quoting を継続すること
- 危険域に近づいた場合は新規 quoting を停止できること
- 緊急域では全注文キャンセルと bot 停止を実行できること
- 在庫が閾値を超えた場合、inventory 圧縮のための reduce-only 処理を独立して実行できること

### Venue Flexibility

- Bullet を最初の本番対応 venue とすること
- Hyperliquid を同じ domain port で扱えること
- venue 固有の order semantics は adapter 層に閉じ込めること

### Persistence and Analysis

- fills を保存し、PnL や execution quality の分析に使えること
- reports を保存し、live / replay の集計結果を残せること
- historical OHLCV を cache し、replay 実行時に再利用できること

## 成功条件

- 3 モードがコードの分岐乱立ではなく、設定と DI の切り替えで動作する
- Bullet `ETH-PERP` で passive maker としての quote フローが成立する
- replay が fetch + cache + report 生成まで一貫して動作する
- analytics として `netPnl`、`tradePnl`、`markout5s`、`markout30s`、`maxDrawdown`、`sharpe`、`fillRate` を扱える
- venue 切り替えと DB 切り替えの影響範囲が adapter / infrastructure / DI に局所化されている

## 初期スコープ

### 対象に含むもの

- Bullet / Hyperliquid の venue abstraction
- `live` / `paper` / `replay` の実行モード
- Avellaneda-Stoikov strategy とその parameterization
- mark price と microprice を使った fair price 計算
- EWMA による volatility 推定
- quote 更新、fill 記録、risk guard、inventory reduction、report 生成
- SQLite を default とする保存基盤
- `DATABASE_URL` による PostgreSQL 切り替え
- Docker / Railway でのデプロイ経路

### 初期スコープから外すもの

- bot 間の strategy orchestration
- 専用モニタリング UI
- 高度な toxic flow 推定モデル
- multi-venue hedging
- perp 以外の資産クラス対応

## 制約

- ランタイムは Bun + TypeScript
- デプロイ先は Railway + Docker
- Clean Architecture の依存方向を崩さない
- `live` / `paper` / `replay` で application 層の振る舞いを揃える

## プロダクト上のリスク

- margin まわりの挙動は venue 依存で、誤ると強制キャンセルや清算リスクに直結する
- paper fill は live execution quality を完全には再現しない
- replay 品質は履歴データの粒度と欠損有無に依存する
- 初期は Bullet 中心でも、将来の venue abstraction が名ばかりにならないように設計段階から担保が必要

## 初期リリース条件

- config 駆動で mode / venue を切り替えられる
- Bullet の `live` / `paper` フローが end-to-end で成立する
- replay が OHLCV の取得、cache、再生を実行できる
- fills から reports を生成できる
- emergency stop と quoting pause の挙動がテストで検証されている
