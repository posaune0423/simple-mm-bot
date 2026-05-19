# Hetzner

## Model

`infra/hetzner/` is the production operations source of truth. `/opt/mmbot` on
the VPS is only a runtime mirror created by GitHub Actions sync.

VPS-local state:

- `.env`
- `data/`
- `backups/`
- `logs/`

These paths are excluded from rsync deletion.

## Planes

| Plane   | Services                                                               | Lifecycle              |
| ------- | ---------------------------------------------------------------------- | ---------------------- |
| Data    | `timescaledb`, `market-data-recorder-bulk`, `external-market-recorder` | always on              |
| Trading | `mmbot-main`, `mmbot-canary`                                           | independently operated |
| Infra   | GitHub Actions, GHCR, `/opt/mmbot` mirror                              | sync and dispatch      |

`restart-bot` recreates only `mmbot-main`. It must not stop TimescaleDB or the
recorder workers.

`SLACK_WEBHOOK_URL` in `/opt/mmbot/.env` is shared by bot and worker containers.
Workers send Slack notifications for fatal startup failures, recorder or
subscription errors, DB insert failures, and shutdown cleanup errors.

## Actions

`ops-hetzner.yml` supports these `workflow_dispatch` actions with
`confirm=yes`:

- `pull-images`
- `start-infra`
- `migrate-db`
- `start-workers`
- `restart-worker`
- `start-bot`
- `stop-bot`
- `restart-bot`
- `start-canary`
- `stop-canary`
- `restart-canary`
- `logs-bot`
- `logs-worker`

The workflow delegates action mapping to
`infra/hetzner/scripts/dispatch-action.sh`, so the same dispatch logic is
locally testable.

## Local DB Access

TimescaleDB is bound to `127.0.0.1:5432` on the VPS. Use an SSH tunnel:

```bash
infra/hetzner/local/open-db-tunnel.sh --host hetzner --local-port 15432
```

Beekeeper:

- Host: `127.0.0.1`
- Port: `15432`
- User: `mmbot_readonly`
- Database: `mm_bot`

Agents and local backtests should use the read-only user:

```bash
DATABASE_URL=postgresql://mmbot_readonly:<password>@127.0.0.1:15432/mm_bot
```

Detailed VPS bootstrap and read-only user SQL remain in
`infra/hetzner/README.md`.
