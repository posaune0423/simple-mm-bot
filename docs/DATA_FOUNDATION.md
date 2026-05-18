# Data Foundation

This project records market data into TimescaleDB/PostgreSQL only. The recorder is a separate process from the bot.

## Goals

- Preserve venue market facts for replay and backtesting.
- Keep public market facts separate from bot execution facts.
- Batch inserts so the recorder can run continuously on a small host.
- Keep the initial schema minimal and destructive while replay infrastructure is still being built.

## Components

| Component                | Process                               | Writes                                                                                  |
| ------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------- |
| TimescaleDB              | Docker Compose service                | PostgreSQL storage with Timescale extension                                             |
| Target market recorder   | `bun run record:market-data`          | `target_market_order_books`, `target_market_trades`, `target_market_tickers`            |
| External market recorder | `bun run record:external-market`      | `external_market_top_of_book`, `external_market_tickers`, `external_market_trades`      |
| Bot runtime              | `bun run start` / `bun run dev:paper` | `bot_runs`, `bot_market_observations`, `bot_quote_decisions`, `bot_orders`, `bot_fills` |
| Analytics views          | database                              | `analytics_quote_markouts`, `analytics_fill_markouts`                                   |

## Recorder Rules

- Recorder must fail fast unless `DATABASE_URL` is PostgreSQL.
- Unsupported venues fail fast with a clear error.
- Invalid books are discarded.
- Inserts are batched by flush interval and max batch size.
- Duplicate market data rows use conflict-do-nothing behavior.
- Shutdown stops the feed, flushes buffers, and exits cleanly.
- Insert failures are logged and do not immediately kill the process.

## Bulk Capture

Bulk is the first implemented recorder venue.

Current capture:

- L2 book snapshots
- ticker facts
- trades when the SDK stream provides them

Book normalization:

```text
mid_price = (best_bid_price + best_ask_price) / 2
micro_price =
  (best_ask_price * best_bid_size + best_bid_price * best_ask_size)
  / (best_bid_size + best_ask_size)
spread_bps =
  (best_ask_price - best_bid_price) / mid_price * 10000
```

Book rejection:

- empty bid or ask side
- crossed book
- non-finite price or size

## External Fair Value Capture

The external market recorder subscribes to public BBO feeds and stores raw
top-of-book facts. The bot can also subscribe to the same feeds in-process and
update `ExternalMarketTopOfBookStore` for synchronous hot-path fair-value
reads.

Configured BTC sources:

- Binance USD-M `btcusdt@bookTicker`
- OKX swap `bbo-tbt` for `BTC-USDT-SWAP`
- Bybit linear `orderbook.1.BTCUSDT`

Fair value is not stored in `external_market_*`. It is reconstructed from raw
BBO rows plus the current weights, staleness, spread, and outlier filters.

## Running Locally

```bash
cp .env.example .env
docker compose up -d timescaledb
bun run db:migrate
docker compose up -d --build market-data-recorder-bulk
docker compose up -d --build external-market-recorder
```

Root `docker-compose.yml` mirrors the Hetzner worker service shape and mounts
`infra/hetzner/configs/worker.bulk.btc.yml` as the recorder config. Production
uses the same config path inside the GHCR image.

Useful checks:

```bash
docker compose ps
docker compose logs -f market-data-recorder-bulk
docker compose exec -T timescaledb psql -U mm -d mm_bot -c "SELECT count(*) FROM target_market_order_books;"
DATABASE_URL=postgresql://mm:mm@127.0.0.1:5432/mm_bot bun run verify:external-recorder --durationMs 30000
bun run probe:external-fair --durationMs 30000
```

For realtime feed quality checks, both scripts support a structured log view and
a terminal table:

```bash
bun run probe:external-fair --view tui --refreshMs 1000 --statsWindowMs 5000
DATABASE_URL=postgresql://mm:mm@127.0.0.1:5432/mm_bot bun run verify:external-recorder --view log --durationMs 30000
```

The per-source rows show latest bid/ask/mid, spread, age, rolling receive Hz
over `--statsWindowMs`, rolling price-change Hz, average Hz since script start,
last price-change age, and `received/price-change` update counts. TUI mode runs
until Ctrl-C when `--durationMs` is omitted.

## Backtest Direction

The current replay direction is to use `target_market_*` for the MM venue and
`external_market_*` for fair-value context. Replay runner and fill simulator
work can reuse the same in-memory store and fair-value calculator as live mode.

The intended future replay flow is:

```text
target_market_* facts
external_market_* facts
  -> replay market feed
  -> ExternalMarketTopOfBookStore
  -> ExternalMarketFairValueCalculator
  -> strategy / quote model
  -> replay order gateway
  -> bot_* facts
  -> analytics_* views
```

Until replay exists, `analytics_quote_markouts` and `analytics_fill_markouts` provide the minimal markout surface for checking quote and fill quality.

## Out Of Scope For Now

- feed session tables
- gap tables
- raw file storage
- replay runner
- fill simulator
- materialized views
- compression policies

## Low-Cost Recorder Defaults

For the Hetzner $5-10/month operating target, external CEX BBO is stored as
`sampled_latest` data by default:

- `sampleIntervalMs: 250`
- `storeRawJson: false`
- `external_market_top_of_book` hot retention: 7 days
- `target_market_order_books` hot retention: 14 days
- bot execution facts retention: 90 days

Use short raw capture windows to validate sampling quality. Do not keep raw
external BBO in the hot PostgreSQL path by default.
