#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILES=(
  -f compose.infra.yml
  -f compose.workers.yml
  -f compose.bots.yml
)

compose() {
  docker compose --env-file .env "${COMPOSE_FILES[@]}" "$@"
}
