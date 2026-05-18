# simple-mm-bot

Bulk Trade-first market making bot built with Bun + TypeScript.

This repository runs the same quoting core in `live`, `paper`, and temporary `backtest` modes. Persistence is PostgreSQL/TimescaleDB only. Continuous venue market data is recorded by a separate worker and kept separate from bot-run facts.

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
- Records target venue market facts through a separate market-data recorder worker.
- Records external CEX BBO facts through a separate external market recorder worker.
- Can use external CEX BBOs for hot-path fair value through an in-memory store.
- Stores bot run facts in `bot_*`, target venue facts in `target_market_*`, and external CEX facts in `external_market_*`.

## Current Scope

Implemented now:

- Bulk Trade `paper` and `live` adapter wiring
- Bulk Trade temporary historical `backtest` wiring
- TimescaleDB schema, hypertables, and analytics markout views
- Bulk market data recorder worker
- Binance/OKX/Bybit external BBO subscriptions for fair-value context
- External market recorder worker for `external_market_top_of_book`
- PostgreSQL-only Drizzle schema and migrations

Not current scope:

- Bullet venue support
- alternative local database runtime support
- Replay runner on the new market data schema
- order/trade capture from external CEX feeds beyond top-of-book

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

Run the external CEX BBO recorder:

```bash
docker compose up -d --build external-market-recorder
```

Root `docker-compose.yml` is the local development wrapper with the same service
names as Hetzner production. It builds the local working tree and defaults
Docker bot containers to paper mode.

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
bun run record:external-market
bun run probe:external-fair
bun run verify:external-recorder
```

Realtime external CEX visibility:

```bash
bun run probe:external-fair --view tui --refreshMs 1000 --statsWindowMs 5000
DATABASE_URL=postgresql://... bun run verify:external-recorder --view log --durationMs 30000
```

`probe:external-fair` shows each configured CEX BBO, rolling update Hz, average
Hz, price-change Hz, age, last price-change age, spread, and fair-value status
without DB access. In TUI mode, omitting `--durationMs` keeps the script running
until Ctrl-C. `verify:external-recorder` shows the same received-feed view while
also validating DB persistence.

Bulk agent wallet registration:

```bash
BULK_MAIN_WALLET_PRIVATE_KEY=... BULK_AGENT_WALLET_PUBLIC_KEY=... bun run bulk:register-agent-wallet
```

Use environment variables for wallet material. `BULK_REMOVE_AGENT_WALLET=true` switches the script to removal mode.

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
- `src/adapters/cex`: Binance, OKX, and Bybit public BBO subscriptions
- `src/adapters/paper`: paper execution and historical feed helpers
- `src/infrastructure/memory`: fixed-slot external top-of-book store for quote hot path
- `src/infrastructure/db/postgres`: Drizzle schema, migration SQL, and repositories
- `src/workers`: standalone worker entry points
- `scripts/lib`: JSON-based evaluation, Bulk YAML tuning, and issue planning helpers

## Database Policy

Only PostgreSQL/TimescaleDB is supported. `DATABASE_URL` must start with `postgres://` or `postgresql://`.

Facts are separated by responsibility:

- `target_market_*`: MM target venue public market facts
- `external_market_*`: external CEX public market facts for fair-value context
- `bot_*`: what the bot observed, decided, submitted, and filled

Target and external market recorders write only public market facts. Bot runtime writes only `bot_*` tables, plus quote diagnostics that reference the external fair-value snapshot it actually used.

See [docs/DATABASE.md](./docs/DATABASE.md) for the schema and [docs/DATA_FOUNDATION.md](./docs/DATA_FOUNDATION.md) for recorder operations.

## Infra And Hetzner

Start with [docs/infra](./docs/infra/README.md) for the concise Docker,
Hetzner, and local DB tunnel map. Production VPS files live under
[infra/hetzner](./infra/hetzner); `/opt/mmbot` is only the runtime mirror.

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
