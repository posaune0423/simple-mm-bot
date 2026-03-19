# simple-mm-bot

> Hyperliquid-first market making bot built with Bun + TypeScript.
>
> This repository is for running the same quoting core in `live`, `paper`, and `backtest` modes, with Avellaneda-Stoikov pricing, SQLite/Postgres persistence, and a Clean Architecture layout that keeps venue logic contained in adapters.

## At a Glance

| Area       | Current setup                                            |
| ---------- | -------------------------------------------------------- |
| Venue      | Hyperliquid                                              |
| Modes      | `live`, `paper`, `backtest`                              |
| Strategy   | Avellaneda-Stoikov                                       |
| Runtime    | Bun + TypeScript                                         |
| Storage    | SQLite by default, PostgreSQL via `DATABASE_URL`         |
| Validation | `check`, unit/integration tests, public-data smoke tests |

## What This Repo Does

- Streams market data from Hyperliquid and computes two-sided quotes.
- Runs the same bot flow in `live`, `paper`, and `backtest`.
- Persists fills, reports, and backtest OHLCV data through repository ports.
- Keeps strategy logic, runtime orchestration, venue adapters, and DB code separated.
- Includes smoke coverage for short public-data backtest and paper sessions.

## Current Scope

This codebase is the implementation track for a market making bot platform, but the current runtime is intentionally narrower than the long-term product docs:

- Implemented now: Hyperliquid venue path, paper mode, backtest mode, live-mode wiring, reporting, SQLite/Postgres switching, and automated test coverage.
- Planned in steering docs: broader venue abstraction goals and future operational expansion.

If you want the product/architecture intent first, start with:

- `docs/PRD.md`
- `docs/TECH.md`
- `docs/STRUCTURE.md`

## Quick Start

### 1. Install

```bash
bun install
```

### 2. Configure environment

Use the committed example as the starting point:

```bash
cp .env.example .env
```

For `paper` and `backtest`, the default public Hyperliquid endpoints are already configured.

For `live`, set:

- `HL_SECRET_KEY`
- optionally `HL_ACCOUNT_ADDRESS`

### 3. Run the bot

Paper mode:

```bash
bun run dev:paper
```

Backtest mode:

```bash
bun run dev:backtest
```

Live mode:

```bash
MODE=live bun run src/main.ts
```

## Main Commands

### Quality gates

```bash
bun run lint
bun run format:check
bun run check
bun run test
bun run test:e2e:paper
```

### Autofix

```bash
bun run lint:fix
bun run check:fix
```

### Strategy validation loop

Runs a backtest followed by a short paper session and writes artifacts under `artifacts/strategy-runs/`:

```bash
bun run loop:backtest-paper --config config/config.paper.yml --from 2024-01-01 --to 2024-01-07
```

### Database tooling

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

The repository structure follows this split:

- `src/domain`: pricing, analytics, entities, ports, strategy
- `src/application`: bot loop, use cases, dependency injection
- `src/adapters`: Hyperliquid and paper/backtest adapters
- `src/infrastructure`: SQLite/Postgres repositories
- `tests`: domain, application, infrastructure, and e2e smoke coverage

## Configuration Notes

- Default config path: `config/config.paper.yml`
- Backtest preset: `config/config.backtest.yml`
- `MODE` can override the config file mode at runtime
- `DATABASE_URL` switches storage to PostgreSQL
- `DB_PATH` controls the local SQLite file path

## Verification Status

The repository currently has:

- unit tests for strategy, analytics, and quote engine behavior
- application tests for bot orchestration and reporting flows
- infrastructure tests for SQLite persistence
- e2e smoke tests for short Hyperliquid public-data backtest and paper sessions

## Why This Layout

The point of this repo is not only to place quotes, but to keep the trading logic testable and replaceable:

- strategy logic should not know about exchange SDK details
- venue-specific behavior should stay in adapters
- storage should be swappable without rewriting domain logic
- paper/backtest should reuse as much runtime flow as possible
