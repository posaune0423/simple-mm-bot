#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

target="${1:-bot}"
tail_lines="${TAIL:-200}"
follow="${FOLLOW:-0}"

case "$target" in
  bot) services=(mmbot-main mmbot-canary) ;;
  worker) services=(market-data-recorder-bulk external-market-recorder) ;;
  *)
    echo "usage: logs.sh [bot|worker]" >&2
    exit 1
    ;;
esac

if [[ "$follow" == "1" ]]; then
  compose logs --tail "$tail_lines" -f "${services[@]}"
else
  compose logs --tail "$tail_lines" "${services[@]}"
fi
