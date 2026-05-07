# Repository Guidelines

## Project Overview

`simple-mm-bot` is a Bun + TypeScript market-making bot. The primary venue is Bulk Trade, the core strategy is Avellaneda-Stoikov, and the same runtime supports `live`, `paper`, and temporary Hyperliquid `backtest` modes.

## Clean Architecture

Implement and extend this codebase following **Clean Architecture** (Robert C. Martin). Obey the **dependency rule**: source dependencies point **inward**—inner circles must not import framework, I/O, or venue-specific code.

| Concern              | In this repo                                                       | Depends on                                               |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Enterprise / domain  | `src/domain` (pure models, strategy math, **ports** as interfaces) | Nothing outside domain                                   |
| Application          | `src/application` (use cases, orchestration, `Bot`, DI wiring)     | Domain only (via ports); no direct SDK or SQL            |
| Interface adapters   | `src/adapters` (Bulk, paper, backtest bridges implementing ports)  | Domain + application contracts                           |
| Frameworks & drivers | `src/infrastructure` (SQLite/Postgres, logging, config loaders)    | Outermost; implements repositories and technical details |

New features should add or extend **use cases** in the application layer, keep **domain** free of venue and persistence details, and push HTTP/WebSocket/DB specifics into **adapters** and **infrastructure**. The **composition root** (e.g. application DI wiring) may construct and inject adapter and infrastructure implementations; individual use cases should still depend on **ports**, not concrete SDK or DB clients. See [docs/STRUCTURE.md](./docs/STRUCTURE.md) for the canonical folder map and [docs/TECH.md](./docs/TECH.md) for runtime and design policy.

## Project Rules

- Do not use `console.log` in production code. Use the repository logger from `src/utils/logger.ts`.
- Keep Bulk-specific API details inside `src/adapters/bulk` or `bulk-ts-sdk` boundaries.
- Do not add Bullet support unless explicitly requested; current docs define Bulk Trade as the active target.
- Generated outputs belong in `artifacts/` or `data/`, not in source directories.
- Capture lessons after corrections by updating `.agents/memory/lessons.md`.
- If a bug belongs outside this bot's responsibility, do not add forced workarounds here; fix the owning dependency instead.
- Do not modify other local projects or repositories unless the user explicitly asks, even when related dependencies exist on disk.

## External Repositories

- `https://github.com/posaune0423/bulk-ts-sdk`: TypeScript SDK boundary for Bulk Trade HTTP/WS/order/account behavior used by this bot.
- `https://github.com/Bulk-trade/bulk-keychain`: key and order-signing implementation used internally by the SDK.

When Bulk API wrapping, account behavior, order payload construction, or SDK typing is wrong, prefer fixing `bulk-ts-sdk`. When order signing itself is wrong, prepare a PR to `bulk-keychain` instead of hiding the issue in this bot.
Do not edit local clones of those repositories from this bot task unless explicitly requested.

## Core Principles

- **Root cause over workarounds**: diagnose the actual failure; fix the owning code (this repo, `bulk-ts-sdk`, or `bulk-keychain`, as documented below)—not symptoms. Avoid compensating logic, opaque retries-as-policy, or config that only hides bugs. Do not stop at the first plausible patch until the fix is verified against the real failure mode. When several fixes are valid, choose the **simplest** one that fully resolves the issue.
- Simplicity First: make every change as simple as possible. Minimize impact, follow YAGNI/KISS/DRY, and avoid compatibility shims unless they are effectively free.
- Minimal Impact: touch only what is necessary and avoid unrelated changes.
- Video Is Canon: when a reference video exists, the implementation should match it.

## Folder Structure

Use [docs/STRUCTURE.md](./docs/STRUCTURE.md) as the source of truth for folder responsibilities, layer boundaries, DI matrix, config files, and test layout. Keep that document updated when adding or moving top-level modules, use cases, scripts, reports, or test areas.

## Docs Reference

- [docs/PRD.md](./docs/PRD.md): product scope, goals, non-goals, modes, and requirements.
- [docs/TECH.md](./docs/TECH.md): stack, architecture policy, runtime flow, and domain design.
- [docs/STRUCTURE.md](./docs/STRUCTURE.md): source of truth for directory responsibilities, layer boundaries, config, DI, and tests.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md): diagrams and high-level architecture overview.

Read these docs before changing runtime behavior, venue support, configuration, or layer boundaries.

## Development Commands

- `bun install`: install dependencies.
- `bun run start`: run live Bulk mode.
- `bun run dev:paper`: run Bulk paper mode.
- `bun run dev:backtest`: run the temporary Hyperliquid backtest path.
- `bun run check`: run type-aware checks.
- `bun run lint` / `bun run lint:fix`: lint or fix code.
- `bun run format:check` / `bun run format`: verify or apply formatting.
- `bun run test`: run unit and integration tests.
- `bun run test:e2e:paper`: run paper/backtest smoke tests.

## Coding & Testing Rules

Follow [.codex/rules/typescript.mdc](./.codex/rules/typescript.mdc) for TypeScript style and [.codex/rules/test.mdc](./.codex/rules/test.mdc) for test style. In short: design types and interfaces first, avoid `any`, prefer functions when no internal state is needed, use adapters for external dependencies, keep tests independent, and import the real implementation from `src/`.

## Cursor Cloud specific instructions

### Environment

- **Runtime**: Bun (not Node). Bun is installed to `~/.bun/bin/bun`; the update script ensures it is on `PATH`. If shell commands cannot find `bun`, run `export PATH="$HOME/.bun/bin:$PATH"`.
- **No external services required**: SQLite is embedded (`bun:sqlite`), auto-created on startup. No Docker, Redis, or Postgres needed for dev/test.
- **`.env` file**: Copy `.env.example` to `.env` before first run. `BULK_PRIVATE_KEY` is only needed for live mode; paper mode and all tests work without it.

### Running the bot

- **Paper mode** (`bun run dev:paper`): Connects to public Bulk Trade WebSocket feed, computes Avellaneda-Stoikov quotes, and simulates fills locally. This is the recommended "hello world" for verifying the environment works. It requires outbound internet access to `exchange-ws1.bulk.trade` and `exchange-api.bulk.trade`.
- **Backtest mode** (`bun run dev:backtest`): Uses Hyperliquid public API for historical OHLCV data. Requires internet access to `api.hyperliquid.xyz`.
- **Live mode** (`bun run start`): Requires `BULK_PRIVATE_KEY` env var; fails fast without it.

### Testing caveats

- `bun run test` runs unit + integration tests (131 + 8 = 139 tests). All pass without network access.
- `bun run test:e2e:paper` runs 2 smoke tests that require internet. The backtest smoke test has a known pre-existing failure (`latestRunPerformance` returns `undefined` venue); the paper smoke test passes.
- Linting/formatting uses `vite-plus` (`vp` CLI): `bun run lint`, `bun run format:check`, `bun run check`.
