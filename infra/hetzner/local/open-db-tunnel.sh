#!/usr/bin/env bash
set -euo pipefail

host="${HETZNER_SSH_HOST:-hetzner}"
local_port="${LOCAL_PORT:-15432}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      host="$2"
      shift 2
      ;;
    --local-port)
      local_port="$2"
      shift 2
      ;;
    *)
      echo "usage: open-db-tunnel.sh [--host hetzner] [--local-port 15432]" >&2
      exit 1
      ;;
  esac
done

exec ssh -N -L "${local_port}:127.0.0.1:5432" "$host"
