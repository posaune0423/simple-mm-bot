# Data Foundation

低コストで market data を集め、backtest の信頼度を上げるための方針。
DB schema は `docs/DATABASE.md` に置く。

## 結論

- primary store は SQLite。
- 運用は小さな VPS 1台 + local disk + `systemd` で始める。
- Market DB と Run DB は分ける。
- Market DB は venue ごと、月ごとに分ける。
- Turso/libSQL は高頻度 ingestion には使わない。
- OHLCV-only backtest は smoke test。採用判断には L2/trade/funding replay を使う。

## What To Collect

| Data               |            Default | Keep | Why                                 |
| ------------------ | -----------------: | ---: | ----------------------------------- |
| L2 top-20 snapshot |                 1s |  30d | quote distance / spread / markout   |
| Book metrics       |                 1s | 180d | mid / micro / spread / imbalance    |
| Public trades      |        every trade |  90d | fill simulation / adverse selection |
| Funding rate       |      60s + updates | 365d | funding signal and funding PnL      |
| Mark/index/oracle  |             1s-60s | 365d | basis and inventory valuation       |
| Candles            |                 1m | 365d | smoke test and regime context       |
| Data gaps          |        every event | 365d | replay coverage checks              |
| Raw payload        | errors/sample only |   7d | decoder audit                       |

`250ms` book capture は canary/debug window だけ。

## Backtest Window

| Window         | Purpose                                   |
| -------------- | ----------------------------------------- |
| last 24h       | latest condition check                    |
| rolling 7d     | default comparison                        |
| selected 2-24h | canary / high-vol / tight-spread replay   |
| rolling 30d    | enough regimes before stronger conclusion |

Bulk はまだ data が薄いので、最初は 7d で回し始める。採用判断は 14-30d 貯まってから。

## Storage Target

1 market は CX23/CX33 相当の local SSD に収める。

| Item                      |                Target |
| ------------------------- | --------------------: |
| hot market DB             |            under 25GB |
| local backup working room |               10-20GB |
| high-res 250ms data       | selected windows only |

30d raw L2 + 90d trades + 180d metrics を超えて重くなったら、raw L2 を削って metrics/candles/funding だけ残す。

## Writer Split

| Component             | Writes                                                                    | Does not write                   |
| --------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| market-data worker    | public book, trades, candles, funding, oracle/index, gaps                 | private account/order state      |
| bot `MetricsRecorder` | runs, decisions, orders, fills, account, position, ledger, runtime events | continuous public market history |

Worker は `MetricsRecorder` の置き換えではない。  
Worker 導入後に `MetricsRecorder` から減らすのは、連続 market snapshot の重複保存だけ。

## Backtest

```text
manifest
  -> Market DB reader
  -> ReplayMarketFeed
  -> Strategy / QuoteModel
  -> ReplayOrderGateway
  -> funding accrual
  -> Run DB ledger
  -> evaluation report
```

| Level | Data                                    | Use                    |
| ----- | --------------------------------------- | ---------------------- |
| T0    | 1m candles                              | smoke only             |
| T1    | 1s L2 + trades + funding + oracle/index | strategy comparison    |
| T2    | 250ms L2 + trades + funding             | fill model sensitivity |

Rules:

- T0 で profitability や funding edge を判断しない。
- replay clock より未来の market event は使わない。
- missing funding / mark / trade は `0` ではなく `unavailable`。
- fill model version、latency assumption、seed を run に保存する。
- fills < 20、markout coverage < 80% なら tuning しない。

## PnL

Funding-aware を評価するなら PnL は ledger で見る。

```text
net_pnl = trade_pnl
        + inventory_pnl
        + funding_pnl
        + rebates
        - fees
        + adjustments
```

`trade_pnl - fee` だけの summary では funding-aware の良し悪しを判断しない。

## Ops

- SQLite file ごとに writer は 1つ。
- WAL、`synchronous=NORMAL`、batch insert を使う。
- market DB は月次 rotate。
- raw websocket payload は default では保存しない。
- backup は `sqlite3 .backup` + `zstd` + `rsync`。
- DuckDB を使う場合は runtime store ではなく read-only analysis から始める。
