# Data Foundation

This project records market data into TimescaleDB/PostgreSQL only. The recorder is a separate process from the bot.

## Goals

- Preserve venue market facts for replay and backtesting.
- Keep public market facts separate from bot execution facts.
- Batch inserts so the recorder can run continuously on a small host.
- Keep the initial schema minimal and destructive while replay infrastructure is still being built.

## Components

| Component            | Process                               | Writes                                                                                  |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| TimescaleDB          | Docker Compose service                | PostgreSQL storage with Timescale extension                                             |
| Market data recorder | `bun run record:market-data`          | `market_data_order_book_snapshots`, `market_data_trades`, `market_data_tickers`         |
| Bot runtime          | `bun run start` / `bun run dev:paper` | `bot_runs`, `bot_market_observations`, `bot_quote_decisions`, `bot_orders`, `bot_fills` |
| Analytics views      | database                              | `analytics_quote_markouts`, `analytics_fill_markouts`                                   |

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

## Running Locally

```bash
cp .env.example .env
docker compose up -d timescaledb
bun run db:migrate
docker compose up -d --build market-data-recorder-bulk
```

Useful checks:

```bash
docker compose ps
docker compose logs -f market-data-recorder-bulk
docker compose exec -T timescaledb psql -U mm -d mm_bot -c "SELECT count(*) FROM market_data_order_book_snapshots;"
```

## Backtest Direction

The current PR builds the storage and recorder foundation only. Replay runner, fill simulator, and external fair price providers are future work.

The intended future replay flow is:

```text
market_data_* facts
  -> replay market feed
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
- external fair price storage
- materialized views
- retention or compression policies
