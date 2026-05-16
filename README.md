# simple-mm-bot

Bulk Trade-first market making bot built with Bun + TypeScript.

This repository runs the same quoting core in `live`, `paper`, and temporary `backtest` modes. Persistence is PostgreSQL/TimescaleDB only. Continuous venue market data is recorded by a separate worker and kept separate from bot run facts.

## At a Glance

| Area       | Current setup                                   |
| ---------- | ----------------------------------------------- |
| Main venue | Bulk Trade                                      |
| SDK        | `bulk-ts-sdk`                                   |
| Modes      | Bulk: `live`, `paper`, `backtest`               |
| Strategy   | Avellaneda-Stoikov / funding-aware PMM variants |
| Runtime    | Bun + TypeScript                                |
| Database   | TimescaleDB / PostgreSQL via `DATABASE_URL`     |

## What This Repo Does

- Streams Bulk Trade market data and computes two-sided quotes.
- Places live Bulk orders through `bulk-ts-sdk` when `BULK_PRIVATE_KEY` is set.
- Runs Bulk `paper` mode with simulated fills on the live feed.
- Records venue market facts through a separate market-data recorder worker.
- Stores bot run facts in `bot_*` tables and venue market facts in `market_data_*` tables.

## Current Scope

Implemented now:

- Bulk Trade `paper` and `live` adapter wiring
- Bulk Trade temporary historical `backtest` wiring
- TimescaleDB schema, hypertables, and analytics markout views
- Bulk market data recorder worker
- PostgreSQL-only Drizzle schema and migrations

Not current scope:

- Bullet venue support
- alternative local database runtime support
- Replay runner on the new market data schema
- CEX recorder implementations beyond fail-fast stubs

## Quick Start

```bash
bun install
cp .env.example .env
```

Start TimescaleDB:

```bash
docker compose up -d timescaledb
bun run db:migrate
```

Run the Bulk market data recorder:

```bash
docker compose up -d --build market-data-recorder-bulk
```

Run the bot:

```bash
bun run dev:paper
bun run start
```

`bun run start` explicitly sets `MODE=live`, `CONFIG_VENUE=bulk`, and `CONFIG_PRESET=beta`. Live order placement fails fast unless `BULK_PRIVATE_KEY` is set.

## Main Commands

```bash
bun run check
bun run test
bun run db:generate
bun run db:migrate
bun run record:market-data
bun run record:bulk
```

Bulk agent wallet registration:

```bash
bun run bulk:register-agent-wallet
```

Before running, edit `scripts/registerBulkAgentWallet.ts` locally and paste the required wallet constants. Restore placeholders after execution and do not commit real keys.

## Runtime Model

The main runtime stays thin:

1. Load typed config from YAML + env.
2. Build dependencies in `src/application/di.ts`.
3. Start the bot loop.
4. Persist bot facts through the PostgreSQL metrics repository.

Repository split:

- `src/domain`: pricing, value objects, pure services, strategy, and ports
- `src/application`: bot loop, use cases, dependency injection, buffered services
- `src/adapters/bulk`: Bulk Trade feed/order/recorder adapters using `bulk-ts-sdk`
- `src/adapters/paper`: paper execution and historical feed helpers
- `src/infrastructure/db/postgres`: Drizzle schema, migration SQL, and repositories
- `src/workers`: standalone worker entry points
- `scripts/lib`: JSON-based evaluation, Bulk YAML tuning, and issue planning helpers

## Database Policy

Only PostgreSQL/TimescaleDB is supported. `DATABASE_URL` must start with `postgres://` or `postgresql://`.

Facts are separated by responsibility:

- `market_data_*`: venue market facts observed from exchange feeds
- `bot_*`: what the bot observed, decided, submitted, and filled

The market-data recorder writes only `market_data_*` tables. Bot runtime writes only `bot_*` tables.

See [docs/DATABASE.md](./docs/DATABASE.md) for the schema and [docs/DATA_FOUNDATION.md](./docs/DATA_FOUNDATION.md) for recorder operations.

## Verification Status

The repository currently has:

- unit tests for domain, application, adapter mapping, recorder buffering, normalization, scripts, config, and package contracts
- integration tests for PostgreSQL market data inserts, destructive migration SQL, and Bulk DI resolution
- coverage output via `bun run test:coverage` under `docs/coverage/`

## Why This Layout

- strategy logic should not know about exchange SDK details
- Bulk-specific behavior stays in `src/adapters/bulk`
- market-data recording runs separately from the bot
- venue market facts and bot execution facts are not mixed
- storage is intentionally PostgreSQL/TimescaleDB-only to keep replay/backtest semantics consistent
