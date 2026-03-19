# simple-mm-bot

Hyperliquid-first market making bot built with Bun and TypeScript.

The repository follows the steering docs in `docs/`:

- `docs/PRD.md`
- `docs/TECH.md`
- `docs/STRUCTURE.md`

## Install dependencies

```bash
bun install
```

## Available checks

```bash
bun run lint # oxlint via vite-plus + DDD dependency graph checks
bun run format:check
bun run check
bun run test
```

## Autofix

```bash
bun run lint:fix
bun run check:fix
```

## Run

```bash
bun run src/main.ts run --mode=paper
bun run dev:backtest
```

## Strategy loop

```bash
bun run loop:backtest-paper --config config/config.paper.yml --from 2024-01-01 --to 2024-01-07
```
