# Hetzner Operations

`infra/hetzner/` is the production operations source of truth. The VPS runtime
mirror is `/opt/mmbot`. The VPS does not need a repository checkout for
production; GitHub Actions sync these files and Docker Compose pulls GHCR
images.

## Runtime Layout

```text
/opt/mmbot
├── compose.infra.yml
├── compose.workers.yml
├── compose.bots.yml
├── configs/
├── scripts/
├── local/
├── .env
├── data/timescaledb/
├── backups/timescaledb/
└── logs/
```

VPS-local only:

- `.env`
- `data/`
- `backups/`
- `logs/`

GitHub Actions rsync protects these paths even when `--delete` is used.

## Required GitHub Secrets

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_SSH_KNOWN_HOSTS`

Use a GitHub Actions deploy key. Do not use a personal 1Password SSH key.
Store the pinned VPS `known_hosts` line in `VPS_SSH_KNOWN_HOSTS`; do not rely on
runtime `ssh-keyscan` in Actions.

## VPS `.env`

Create `/opt/mmbot/.env` manually:

```bash
POSTGRES_PASSWORD=replace-with-long-random-password
MMBOT_IMAGE=ghcr.io/posaune0423/simple-mm-bot:main
LOG_LEVEL=INFO

BULK_PRIVATE_KEY=replace-with-main-bot-key
BULK_CANARY_PRIVATE_KEY=replace-with-canary-key
SLACK_WEBHOOK_URL=
```

`BULK_CANARY_PRIVATE_KEY` may be omitted only if the canary is not used.

## Initial Setup

```bash
sudo mkdir -p /opt/mmbot
sudo chown "$USER":"$USER" /opt/mmbot
cd /opt/mmbot
mkdir -p data/timescaledb backups/timescaledb logs
```

After `sync-hetzner-infra` has copied the files:

```bash
chmod +x scripts/*.sh local/*.sh
docker compose --env-file .env \
  -f compose.infra.yml \
  -f compose.workers.yml \
  -f compose.bots.yml \
  config -q
```

Start the data plane:

```bash
./scripts/start-infra.sh
docker compose --env-file .env \
  -f compose.infra.yml \
  -f compose.workers.yml \
  -f compose.bots.yml \
  run --rm --no-deps mmbot-main bun run db:migrate
./scripts/start-workers.sh
```

Start trading:

```bash
./scripts/start-bot.sh
```

## Operations

GitHub Actions `ops-hetzner.yml` runs these actions with `confirm=yes`:

- `pull-images`
- `start-infra`
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

`restart-bot` only recreates `mmbot-main`. It does not restart TimescaleDB or
`market-data-recorder-bulk`.

Do not use `docker compose down` in production operations.

## Local DB Tunnel

TimescaleDB is bound to `127.0.0.1:5432` on the VPS and is not publicly exposed.
From the local machine:

```bash
infra/hetzner/local/open-db-tunnel.sh --host hetzner --local-port 15432
```

Equivalent raw command:

```bash
ssh -N -L 15432:127.0.0.1:5432 hetzner
```

Beekeeper:

- Host: `127.0.0.1`
- Port: `15432`
- User: `mmbot_readonly`
- Database: `mm_bot`

Agent and local backtest:

```bash
DATABASE_URL=postgresql://mmbot_readonly:<password>@127.0.0.1:15432/mm_bot
```

Copy `infra/hetzner/local/agent-db.env.example` when an agent needs a local
read-only database environment.

## Read-Only User

Create this user on the VPS after TimescaleDB is running. Replace the password
before execution.

```bash
docker compose --env-file .env \
  -f compose.infra.yml \
  -f compose.workers.yml \
  -f compose.bots.yml \
  exec -T timescaledb psql -U mm -d mm_bot <<'SQL'
CREATE ROLE mmbot_readonly LOGIN PASSWORD 'replace-with-readonly-password';
GRANT CONNECT ON DATABASE mm_bot TO mmbot_readonly;
GRANT USAGE ON SCHEMA public TO mmbot_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mmbot_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO mmbot_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mmbot_readonly;
SQL
```

Verify through the SSH tunnel:

Prerequisites: install PostgreSQL client tools locally.

- Ubuntu/Debian: `apt-get install postgresql-client`
- macOS: `brew install postgresql@16`

```bash
pg_isready -h 127.0.0.1 -p 15432 -U mmbot_readonly -d mm_bot
psql "$DATABASE_URL" -c "select now();"
psql "$DATABASE_URL" -c "create table readonly_probe(id int);"
```

The final command must fail with a permission error.

## Backups

```bash
./scripts/backup-db.sh
```

Backups are written to `/opt/mmbot/backups/timescaledb`. Files older than
`BACKUP_RETENTION_DAYS` are deleted; the default is 14 days.
