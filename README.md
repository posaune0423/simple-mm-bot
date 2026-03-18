# simple-mm-bot

This repository stays as a Bun TypeScript project.

Tooling is configured through Vite+ in `vite.config.ts`, so linting, formatting, and static checks are centralized without adding a frontend app.

## Install dependencies

```bash
bun install
```

## Available checks

```bash
bun run lint
bun run format:check
bun run check
```

## Autofix

```bash
bun run lint:fix
bun run check:fix
```

## Run the Bun entrypoint

```bash
bun run index.ts
```
