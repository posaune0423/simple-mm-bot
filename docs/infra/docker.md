# Docker

## Image

The root `Dockerfile` builds the single app image used by both local Compose
and GHCR production publishing.

Default command:

```bash
bun run src/main.ts
```

Compose files may override the command for worker-specific entrypoints.

## Local Compose

Use root `docker-compose.yml` for local development. It mirrors the Hetzner
service names and config mount paths, but stays self-contained so local Compose
does not require production-only secrets.

Start local TimescaleDB:

```bash
docker compose up -d timescaledb
bun run db:migrate
```

Start the Bulk market data recorder from the local working tree:

```bash
docker compose up -d --build market-data-recorder-bulk
```

Run the bot in local paper mode through Docker:

```bash
docker compose up --build mmbot-main
```

Run canary in local paper mode:

```bash
docker compose up --build mmbot-canary
```

Root Compose defaults bot containers to `MODE=paper`. Set `MODE=live` explicitly
only when intentionally testing live behavior.

## Production Compose

Production does not use root `docker-compose.yml`. GitHub Actions sync
`infra/hetzner/` to `/opt/mmbot`, and the VPS scripts run:

```bash
docker compose --env-file .env \
  -f compose.infra.yml \
  -f compose.workers.yml \
  -f compose.bots.yml \
  ...
```

Production pulls `MMBOT_IMAGE`, defaulting to
`ghcr.io/posaune0423/simple-mm-bot:main`.
