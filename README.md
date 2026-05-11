# simple-mm-bot

> Bulk Trade-first market making bot built with Bun + TypeScript.
>
> This repository runs the same quoting core in `live`, `paper`, and `backtest` modes, with Avellaneda-Stoikov pricing, SQLite/Postgres persistence, and venue logic isolated in adapters.

## At a Glance

| Area       | Current setup                                                          |
| ---------- | ---------------------------------------------------------------------- |
| Main venue | Bulk Trade                                                             |
| SDK        | `bulk-ts-sdk`, a local API wrapper maintained by this repository owner |
| Modes      | Bulk: `live`, `paper`, `backtest`                                      |
| Strategy   | Avellaneda-Stoikov                                                     |
| Runtime    | Bun + TypeScript                                                       |
| Storage    | SQLite by default, PostgreSQL via `DATABASE_URL`                       |

## What This Repo Does

- Streams Bulk Trade market data and computes two-sided quotes.
- Places live Bulk orders through `bulk-ts-sdk` when `BULK_PRIVATE_KEY` is set.
- Runs the same bot flow in Bulk `paper` mode with simulated fills.
- Runs Bulk historical backtests from `bulk-ts-sdk` klines with simulated fills.
- Persists fills, reports, and Bulk live / paper OHLCV candles through repository ports.

## Current Scope

Implemented now:

- Bulk Trade `paper` and `live` adapter wiring
- Bulk Trade historical `backtest` wiring
- `bulk-ts-sdk` integration for Bulk HTTP/WS/order/account APIs
- Reporting, SQLite/Postgres switching, and automated test coverage

Not current scope:

- Bullet venue support
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

Bulk live mode:

```bash
bun run start
```

`bun run start` explicitly sets `MODE=live` and uses `config/config.bulk.beta.yml`.
This is the beta/mock-capital live preset. It sends Bulk Trade orders and fails fast unless `BULK_PRIVATE_KEY` is set.

Bulk mainnet live mode uses the conservative real-capital preset:

```bash
CONFIG_PATH=config/config.bulk.mainnet.yml MODE=live bun run src/main.ts
```

Bulk paper mode, using the same Bulk market feed with simulated execution:

```bash
bun run dev:paper
```

Bulk historical backtest mode:

```bash
bun run dev:backtest
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
bun run loop:backtest-paper --backtest-config config/config.backtest.yml --paper-config config/config.paper.yml --from 2026-05-06 --to 2026-05-07
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
- `src/adapters/hyperliquid`: legacy compatibility
- `src/adapters/paper`: paper execution and historical feed helpers
- `src/infrastructure`: metrics contracts plus SQLite/Postgres repositories
- `scripts/lib`: external evaluation, Bulk YAML tuning, and issue planning helpers
- `tests`: unit, integration, and e2e test suites; see `docs/TEST.md`

## Configuration Notes

- Default config path: `config/config.bulk.beta.yml`
- Bulk beta live preset: `config/config.bulk.beta.yml`
- Bulk mainnet live preset: `config/config.bulk.mainnet.yml`
- Bulk paper preset: `config/config.paper.yml`
- Bulk template: `config/config.example.yml`
- Bulk backtest preset: `config/config.backtest.yml`
- `MODE` can override the config file mode at runtime
- `DATABASE_URL` controls storage. Use `file:data/mm.db` for local SQLite, or `postgres://` / `postgresql://` for PostgreSQL.

Bulk backtest currently replays historical OHLCV from `klines` and uses the paper fill model. Bulk historical L2 is not exposed by the current SDK/API, so backtest fill quality is approximate.

Path defaults and generation destinations are centralized in `src/runtimePaths.ts`.

## Verification Status

The repository currently has:

- unit tests for strategy, analytics, quote engine behavior, application use cases, adapter mapping, reporting, scripts, config, and package contracts
- integration tests for SQLite/Postgres persistence, report queries, Bulk DI resolution, and fixture-backed quote-cycle latency telemetry
- e2e smoke tests for Bulk backtest and Bulk paper sessions
- coverage output via `bun run test:coverage` under `docs/coverage/`

## Why This Layout

- strategy logic should not know about exchange SDK details
- Bulk-specific behavior stays in `src/adapters/bulk`
- `bulk-ts-sdk` is used because Bulk Trade does not currently provide an official TypeScript SDK
- storage should be swappable without rewriting domain logic
- paper/backtest should reuse as much runtime flow as possible
