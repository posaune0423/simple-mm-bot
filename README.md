# simple-mm-bot

> Bulk Trade-first market making bot built with Bun + TypeScript.
>
> This repository runs the same quoting core in `live`, `paper`, and `backtest` modes, with Avellaneda-Stoikov pricing, SQLite/Postgres persistence, and venue logic isolated in adapters.

## At a Glance

| Area       | Current setup                                                          |
| ---------- | ---------------------------------------------------------------------- |
| Main venue | Bulk Trade                                                             |
| SDK        | `bulk-ts-sdk`, a local API wrapper maintained by this repository owner |
| Modes      | Bulk: `live`, `paper`; Hyperliquid: temporary `backtest` path          |
| Strategy   | Avellaneda-Stoikov                                                     |
| Runtime    | Bun + TypeScript                                                       |
| Storage    | SQLite by default, PostgreSQL via `DATABASE_URL`                       |

## What This Repo Does

- Streams Bulk Trade market data and computes two-sided quotes.
- Places live Bulk orders through `bulk-ts-sdk` when `BULK_PRIVATE_KEY` is set.
- Runs the same bot flow in Bulk `paper` mode with simulated fills.
- Keeps Hyperliquid only for the current historical backtest path until Bulk historical data is wired.
- Persists fills, reports, and backtest OHLCV data through repository ports.

## Current Scope

Implemented now:

- Bulk Trade `paper` and `live` adapter wiring
- `bulk-ts-sdk` integration for Bulk HTTP/WS/order/account APIs
- Hyperliquid public-data backtest adapter
- Reporting, SQLite/Postgres switching, and automated test coverage

Not current scope:

- Bullet venue support
- Bulk backtest/replay support
- Multi-venue hedging or XEMM

## Quick Start

### 1. Install

```bash
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Bulk HTTP/WS URLs, market, and L2 depth live in committed YAML config. The only Bulk secret env var is:

- `BULK_PRIVATE_KEY`: required only for live Bulk order placement

### 3. Run

Bulk paper mode:

```bash
bun run dev:paper
```

Bulk live mode:

```bash
MODE=live bun run src/main.ts
```

Temporary Hyperliquid backtest mode:

```bash
CONFIG_PATH=config/config.backtest.yml MODE=backtest bun run src/main.ts
```

## Main Commands

```bash
bun run lint
bun run format:check
bun run check
bun run test
bun run test:e2e:paper
```

Strategy validation loop:

```bash
bun run loop:backtest-paper --backtest-config config/config.backtest.yml --paper-config config/config.paper.yml --from 2024-01-01 --to 2024-01-07
```

Database tooling:

```bash
bun run db:generate
bun run db:migrate
```

## Runtime Model

The main runtime stays thin:

1. Load typed config from YAML + env
2. Build dependencies in `src/application/di.ts`
3. Start the bot loop
4. Produce a final report

Repository split:

- `src/domain`: pricing, analytics, entities, ports, strategy
- `src/application`: bot loop, use cases, dependency injection
- `src/adapters/bulk`: Bulk Trade feed/order adapters using `bulk-ts-sdk`
- `src/adapters/hyperliquid`: temporary public-data backtest support
- `src/adapters/paper`: paper execution and historical feed helpers
- `src/infrastructure`: SQLite/Postgres repositories
- `tests`: domain, application, adapter, infrastructure, and e2e smoke coverage

## Configuration Notes

- Default config path: `config/config.bulk.yml`
- Bulk paper preset: `config/config.paper.yml`
- Bulk template: `config/config.example.yml`
- Temporary backtest preset: `config/config.backtest.yml`
- `MODE` can override the config file mode at runtime
- `DATABASE_URL` switches storage to PostgreSQL
- `DB_PATH` controls the local SQLite file path

## Verification Status

The repository currently has:

- unit tests for strategy, analytics, and quote engine behavior
- application tests for bot orchestration, reporting, and Bulk DI resolution
- adapter tests for Bulk market snapshots, order mapping, rejection handling, and fill normalization
- infrastructure tests for SQLite persistence
- e2e smoke tests for the temporary Hyperliquid public-data backtest and Bulk paper sessions

## Why This Layout

- strategy logic should not know about exchange SDK details
- Bulk-specific behavior stays in `src/adapters/bulk`
- `bulk-ts-sdk` is used because Bulk Trade does not currently provide an official TypeScript SDK
- storage should be swappable without rewriting domain logic
- paper/backtest should reuse as much runtime flow as possible
