---
name: backtest-paper-loop
description: Manages the Polymarket MM strategy evaluation loop for this repository. Use when running or tuning backtests, paper tests, candidate comparisons, or replay-first promotion workflows.
---

# Backtest Paper Loop

Use this skill when the task is to evaluate, compare, or tune strategy candidates in this repository.

## Primary Command

Run the loop orchestrator:

```bash
bun run src/index.ts loop --recording=<path> --paperMode=replay
```

Use replay mode by default when validating code or running offline.

## Candidate Workflow

1. Start with `balanced`, `tight-rebate`, and `inventory-defensive`.
2. Compare candidates by `verdict`, `score`, `netPnlUsd`, `inventoryDriftUsd`, and `adverseMarkoutStreak`.
3. Only move to realtime paper testing when replay results are stable and the user explicitly wants live market access.
4. Keep `autoStartLive=false` until the user asks for canary promotion.

## Expected CLI Variants

Replay-first evaluation:

```bash
bun run src/index.ts loop --recording=./data/recordings/<file>.ndjson.gz --paperMode=replay
```

Realtime paper test after replay:

```bash
bun run src/index.ts loop --recording=./data/recordings/<file>.ndjson.gz --paperMode=realtime --paperDurationMs=60000
```

Limit to specific candidates:

```bash
bun run src/index.ts loop --recording=<path> --paperMode=replay --candidates=balanced,tight-rebate
```

## Tuning Rules

- Prefer minimal parameter moves over adding new strategy branches.
- Edit candidate presets in `src/usecases/mm-platform.ts` before inventing new runtime modes.
- Keep strategy logic in `src/domain/mm/reward-rebate-optimal-mm-strategy.ts`.
- Favor replay-first validation before touching live execution behavior.

## Required Checks

- Run targeted tests after strategy or loop changes.
- Run `bun run lint`, `bun run typecheck`, and relevant `bun test` commands before handoff.
