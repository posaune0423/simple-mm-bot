# Repository Guidelines

## Project Overview

`simple-mm-bot` is a Bun + TypeScript market-making bot. The primary venue is Bulk Trade, the core strategy is Avellaneda-Stoikov, and the same runtime supports `live`, `paper`, and temporary Hyperliquid `backtest` modes.

## Clean Architecture

Implement and extend this codebase following **DDD and Clean Architecture** (Robert C. Martin). Obey the **dependency rule**: source dependencies point **inward**—inner circles must not import framework, I/O, or venue-specific code.

| Concern              | In this repo                                                       | Depends on                                               |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Enterprise / domain  | `src/domain` (pure models, strategy math, **ports** as interfaces) | Nothing outside domain                                   |
| Application          | `src/application` (use cases, orchestration, `Bot`, DI wiring)     | Domain only (via ports); no direct SDK or SQL            |
| Interface adapters   | `src/adapters` (Bulk, paper, backtest bridges implementing ports)  | Domain + application contracts                           |
| Frameworks & drivers | `src/infrastructure` (SQLite/Postgres, logging, config loaders)    | Outermost; implements repositories and technical details |

New features should add or extend **use cases** in the application layer, keep **domain** free of venue and persistence details, and push HTTP/WebSocket/DB specifics into **adapters** and **infrastructure**. The **composition root** (e.g. application DI wiring) may construct and inject adapter and infrastructure implementations; individual use cases should still depend on **ports**, not concrete SDK or DB clients. See [docs/STRUCTURE.md](./docs/STRUCTURE.md) for the canonical folder map and [docs/TECH.md](./docs/TECH.md) for runtime and design policy.

## TypeScript Design

Write TypeScript as a strict, type-safe domain model first. Prefer explicit domain types, value objects, ports, and use-case contracts over primitive plumbing across layers.

- Use `neverthrow` `Result` / `ResultAsync` for expected domain, application, adapter, and infrastructure failures that callers can handle.
- Keep thrown errors for unrecoverable startup/runtime boundaries or truly exceptional failures; do not encode normal business validation or recoverable venue outcomes as unchecked exceptions.
- Define layer-owned error types (`DomainError`, `ApplicationError`, adapter/infrastructure errors) and return them through `Result` where recovery or branching is part of the contract.
- Use `ts-pattern` for type-safe matching over discriminated unions, closed state machines, venue/mode routing, side/intent matrices, and exhaustive policy decisions.
- Do not mechanically replace simple guard clauses with `ts-pattern` when an `if` keeps the code clearer.
- Preserve exhaustiveness: when a union grows, update the `ts-pattern` match and tests in the same change.

## Project Rules

- Do not use `console.log` in production code. Use the repository logger from `src/utils/logger.ts`.
- Keep Bulk-specific API details inside `src/adapters/bulk` or `bulk-ts-sdk` boundaries.
- Do not add Bullet support unless explicitly requested; current docs define Bulk Trade as the active target.
- Generated outputs belong in `data/`, not in source directories.
- Database selection uses `DATABASE_URL` only: `file:<path>` for SQLite (default `file:data/mm.db`), `postgres://` / `postgresql://` for PostgreSQL. Use `src/utils/databaseUrl.ts` for detection and do not add `DB_PATH` runtime branches.
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

## Knowledge Base (Obsidian)

- **Entry note**: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Private/MM bot.md`
- **High-signal topics**: Avellaneda–Stoikov, markout, queue-awareness, VPIN, toxic flow, order types/book microstructure.
- **Available skills**: `obsidian-cli`, `obsidian-markdown`, `obsidian-bases`

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
