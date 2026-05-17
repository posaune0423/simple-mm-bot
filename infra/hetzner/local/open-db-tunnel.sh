#!/usr/bin/env bash
set -euo pipefail

host="${HETZNER_SSH_HOST:-hetzner}"
local_port="${LOCAL_PORT:-15432}"
usage="usage: open-db-tunnel.sh [--host hetzner] [--local-port 15432]"

require_option_value() {
  if [[ $# -lt 2 || -z "${2:-}" || "${2:0:1}" == "-" ]]; then
    echo "$usage" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      require_option_value "$@"
      host="$2"
      shift 2
      ;;
    --local-port)
      require_option_value "$@"
      local_port="$2"
      shift 2
      ;;
    *)
      echo "$usage" >&2
      exit 1
      ;;
  esac
done

exec ssh -N -L "${local_port}:127.0.0.1:5432" "$host"
