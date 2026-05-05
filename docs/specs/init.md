# Legacy Initial Spec

この文書は初期 bootstrap 時点の要件メモを置き換えるための互換ファイル。

現在の正は以下の 3 ファイルに集約する。

- `docs/PRD.md`
- `docs/TECH.md`
- `docs/STRUCTURE.md`

## Current Scope

現在の主対象 venue は Bulk Trade。

Bulk Trade には公式 TypeScript SDK がないため、repo owner が API を wrap して実装した `bulk-ts-sdk` を利用する。
bot 側では `src/adapters/bulk/` に SDK 依存を閉じ込め、domain / application 層は Bulk API payload を直接扱わない。

## Out Of Scope

Bullet venue は現在の対応対象ではない。

Bulk historical backtest は未対応。
当面の backtest / smoke validation は既存の Hyperliquid historical path を一時的に利用する。
