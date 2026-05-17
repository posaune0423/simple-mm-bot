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

The market-data recorder is a separate worker:

```bash
bun run record:market-data
```

It builds:

- a PostgreSQL Drizzle client
- `PostgresMarketDataRepository`
- `MarketDataBufferedWriter`
- a venue-specific `IMarketDataRecorderClient`

The recorder writes only `market_data_*` tables. It does not write bot run facts.

## Persistence

`DATABASE_URL` is PostgreSQL-only and must start with `postgres://` or `postgresql://`.

Schema source of truth:

- Drizzle schema: `src/infrastructure/db/postgres/schema.ts`
- migration SQL: `src/infrastructure/db/postgres/migrations/0000_timescale_market_data_foundation.sql`
- docs: `docs/DATABASE.md`

Table families:

- `market_data_order_book_snapshots`
- `market_data_trades`
- `market_data_tickers`
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

Recorder env:

- `RECORDER_VENUE`
- `RECORDER_SYMBOL`
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
