# TECH

## Purpose

`simple-mm-bot` is a Bun + TypeScript market making bot. Bulk Trade is the primary venue. Bullet is out of scope.

The current persistence policy is PostgreSQL/TimescaleDB only.

## Stack

- Runtime: Bun
- Language: TypeScript
- Error handling: `neverthrow` `Result` / `ResultAsync`
- Pattern matching: `ts-pattern`
- Validation: Valibot
- Linter / formatter: vite plus
- ORM / migration: Drizzle Postgres
- Database: PostgreSQL with TimescaleDB
- Venue SDK: `bulk-ts-sdk`

## Architecture

The codebase follows DDD / Clean Architecture.

| Layer          | Responsibility                                               | May depend on                                  |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Domain         | Pure market making logic, value objects, ports, strategy     | no outer layer                                 |
| Application    | Bot loop, use case orchestration, DI composition             | domain                                         |
| Adapters       | Venue and mode implementations                               | domain ports, SDKs                             |
| Infrastructure | Database clients, Drizzle schema, repositories, git metadata | domain ports, storage libraries                |
| Workers        | Standalone process entry points                              | application services, adapters, infrastructure |

Rules:

- Domain does not import SDK, HTTP, WS, DB, config loader, or logger.
- Application coordinates ports and use cases; it does not write SQL.
- Bulk API details stay in `src/adapters/bulk` or `bulk-ts-sdk`.
- Database-specific code stays in `src/infrastructure/db/postgres`.

## Runtime Flow

`main.ts` loads config, builds `DIContainer`, starts `Bot`, and installs shutdown signal handling.

One bot tick:

1. Check risk with `GuardRiskUseCase`.
2. Drain queued metric/fill tasks.
3. Sync position when needed.
4. Reduce inventory before normal quoting if thresholds are breached.
5. Run `QuotingCycleService` when risk is `OK`.
6. Persist bot facts through `MetricsRecorder`.

## Market Data Recorder

The target market recorder is a separate worker:

```bash
bun run record:market-data
```

It builds:

- a PostgreSQL Drizzle client
- `PostgresMarketDataRepository`
- `MarketDataBufferedWriter`
- a venue-specific `IMarketDataRecorderClient`

It writes only `target_market_*` tables. It does not write bot run facts.

The external market recorder is a separate worker:

```bash
bun run record:external-market
```

It builds external CEX subscriptions, `ExternalMarketBufferedWriter`, and
`PostgresExternalMarketRepository`. It writes raw `external_market_*` facts for
replay and diagnostics.

External feed inspection scripts expose the same subscription path in realtime:

```bash
bun run probe:external-fair --view tui --refreshMs 1000 --statsWindowMs 5000
DATABASE_URL=postgresql://... bun run verify:external-recorder --view log --durationMs 30000
```

The TUI/log rows show the latest BBO, age, spread, rolling receive Hz, rolling
price-change Hz, average Hz, last price-change age, and `received/price-change`
counts for each configured external source. TUI mode runs until Ctrl-C when
`--durationMs` is omitted.

When `quoteEngine.externalFair.enabled=true`, the bot runtime also starts
external CEX subscriptions and updates `ExternalMarketTopOfBookStore`. The
quote hot path reads that store synchronously through `IFairValueProvider`; it
does not perform DB reads, REST calls, WebSocket receives, or JSON parsing while
computing quotes.

## Persistence

`DATABASE_URL` is PostgreSQL-only and must start with `postgres://` or `postgresql://`.

Schema source of truth:

- Drizzle schema: `src/infrastructure/db/postgres/schema.ts`
- migration SQL: `src/infrastructure/db/postgres/migrations/0000_timescale_market_data_foundation.sql`
- docs: `docs/DATABASE.md`

Table families:

- `target_market_order_books`
- `target_market_trades`
- `target_market_tickers`
- `external_market_top_of_book`
- `external_market_tickers`
- `external_market_trades`
- `bot_runs`
- `bot_market_observations`
- `bot_quote_decisions`
- `bot_orders`
- `bot_fills`

Views:

- `analytics_quote_markouts`
- `analytics_fill_markouts`

All time columns are epoch milliseconds in `BIGINT`.

## Configuration

- Default config selection: `CONFIG_VENUE=bulk`, `CONFIG_PRESET=beta`
- Bulk beta preset: `config/bulk/beta.yml`
- Bulk mainnet preset: `config/bulk/mainnet.yml`
- `MODE` can override the config file mode.
- `DATABASE_URL` defaults to local TimescaleDB: `postgresql://mm:mm@127.0.0.1:5432/mm_bot`.
- `BULK_PRIVATE_KEY` is required only for live Bulk order placement.
- External public BBO feeds use `quoteEngine.externalFair.sources`.
- `EXTERNAL_FAIR_ENABLED=true` can enable the configured external fair runtime.

Recorder env:

- `RECORDER_VENUE`
- `RECORDER_SYMBOL`

External recorder env:

- `EXTERNAL_MARKET_RECORDER_CONFIG_PATH`
- `EXTERNAL_MARKET_FLUSH_INTERVAL_MS`
- `EXTERNAL_MARKET_MAX_BATCH_SIZE`
- `EXTERNAL_MARKET_TOP_OF_BOOK_MODE` (`sampled_latest` by default)
- `EXTERNAL_MARKET_TOP_OF_BOOK_SAMPLE_INTERVAL_MS` (`250` by default)
- `EXTERNAL_MARKET_TOP_OF_BOOK_STORE_RAW_JSON` (`false` by default)
- `BINANCE_USDM_SYMBOL`
- `OKX_SWAP_SYMBOL`
- `BYBIT_LINEAR_SYMBOL`
- `BINANCE_USDM_WS_URL`
- `OKX_WS_URL`
- `BYBIT_LINEAR_WS_URL`
- `BINANCE_USDM_API_KEY` / `BINANCE_API_KEY`
- `OKX_API_KEY`
- `BYBIT_API_KEY`
- `RECORDER_DEPTH`
- `RECORDER_FLUSH_INTERVAL_MS`
- `RECORDER_MAX_BATCH_SIZE`
- `BULK_HTTP_URL`
- `BULK_WS_URL`

## Testing

| Test type   | Scope                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| Unit        | domain, application services, adapters, market data normalization, scripts |
| Integration | PostgreSQL repositories, migration SQL, DI composition                     |
| Coverage    | Bun native coverage plus summary generation                                |

Commands:

```bash
bun run check
bun run test
bun run test:coverage
```

## Deployment

- Docker base image is `oven/bun:1`.
- Root `docker-compose.yml` is for local development and keeps the same service names as the Hetzner compose services.
- Production Compose lives in `infra/hetzner/compose.*.yml` and is synced to `/opt/mmbot`.
- Recorder container uses `platform: linux/amd64` because the current Bulk signing dependency does not ship a Linux arm64 binding.
