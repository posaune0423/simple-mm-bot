#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${ACTION:-}"
CONFIRM="${CONFIRM:-}"

if [[ "$CONFIRM" != "yes" ]]; then
  echo "Refusing to run: confirm=yes is required" >&2
  exit 1
fi

case "$ACTION" in
  pull-images) bash "$SCRIPT_DIR/pull-images.sh" ;;
  start-infra) bash "$SCRIPT_DIR/start-infra.sh" ;;
  start-workers) bash "$SCRIPT_DIR/start-workers.sh" ;;
  restart-worker) bash "$SCRIPT_DIR/restart-worker.sh" ;;
  start-bot) bash "$SCRIPT_DIR/start-bot.sh" ;;
  stop-bot) bash "$SCRIPT_DIR/stop-bot.sh" ;;
  restart-bot) bash "$SCRIPT_DIR/restart-bot.sh" ;;
  start-canary) bash "$SCRIPT_DIR/start-canary.sh" ;;
  stop-canary) bash "$SCRIPT_DIR/stop-canary.sh" ;;
  restart-canary) bash "$SCRIPT_DIR/restart-canary.sh" ;;
  logs-bot) bash "$SCRIPT_DIR/logs.sh" bot ;;
  logs-worker) bash "$SCRIPT_DIR/logs.sh" worker ;;
  *)
    echo "Unknown ACTION: ${ACTION}" >&2
    exit 1
    ;;
esac
