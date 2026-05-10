---
name: report-visualize-ja
description: SQLiteのfillsから主要MM指標を集計し、依存ライブラリゼロでSVGを自前生成して docs/reports/ にgit管理可能な形で書き出す日本語ガイド。
---

# Report Visualize (日本語)

## 目的

`data/mm.db` の fills を元にbotの主要KPIを可視化し、`docs/reports/latest.md` と `docs/reports/history/YYYY-MM-DD.md` に書き出す。SVGはテキストベースで生成されるため git の diff が読みやすく、過去スナップショットの比較にも向く。

## 主なコマンド

```bash
bun run report:generate
# またはオプション付き
bun run report:generate -- --mode live --venue hyperliquid --period both --output docs/reports
```

## オプション

- `--mode` `live` | `paper` | `backtest` (default: `live`)
- `--venue` venue名 (例: `hyperliquid`, `bulk`)。未指定で全venue
- `--period` `24h` | `7d` | `both` (default: `both`)
- `--output` 出力ディレクトリ (default: `docs/reports`)
- `--db` SQLiteパス (default: `Bun.env.DB_PATH ?? "data/mm.db"`)
- `--now` epoch ms — テスト/再現用。本番は省略

## 出力

- `docs/reports/latest.md` — 毎回上書き（最新日のグラフを参照）
- `docs/reports/YYYY-MM-DD/report.md` — 日次スナップショットのディレクトリとレポート本体
- `docs/reports/YYYY-MM-DD/charts/{24h,7d}/<chart>.svg` — 各日付ディレクトリ内の個別グラフ

## グラフ一覧

| 階層 | グラフ名                        | 期間        |
| ---- | ------------------------------- | ----------- |
| 1    | Equity curve (累積純損益)       | 24h, 7d     |
| 1    | Drawdown (ドローダウン)         | 24h, 7d     |
| 1    | Markout 5s ヒストグラム         | 24h, 7d     |
| 1    | Markout 30s ヒストグラム        | 24h, 7d     |
| 1    | 毎時平均 Markout 5s (bps)       | 24h, 7d     |
| 1    | KPI サマリーテーブル            | 24h+7d 統合 |
| 2    | Trade PnL ヒストグラム          | 24h, 7d     |
| 2    | 毎時 Adverse selection レート   | 24h, 7d     |
| 2    | 毎時約定数 (Buy/Sell)           | 24h, 7d     |
| 2    | 毎時 Fee vs Trade PnL           | 24h, 7d     |
| 3    | Rolling Sharpe (60-fill window) | 7d          |
| 3    | 通貨ペア別 Notional Volume      | 24h, 7d     |
| 3    | 約定価格 vs Mid (散布図)        | 24h         |

## ワークフロー

1. `bun run report:generate -- --period both` を実行
2. `docs/reports/latest.md` をプレビューで確認
3. `git diff docs/reports/` で前回との差分を確認
4. スナップショット採用時は markdown と charts をまとめて1コミットに

## 検証

- `bun test tests/reporting tests/infrastructure/FillsQuery.test.ts` — テスト
- `bun run check` — lint/typecheck
- `xmllint --noout docs/reports/charts/**/*.svg` — SVG構文
- markdownを目視確認

## 注意

- 該当期間にfillが無い場合は "No data" プレースホルダで描画される (失敗しない)
- `--now` を渡すと決定論的に実行できるので CI 用途に便利
- SQLiteはSELECTのみ。live実行中でも安全に呼べる
