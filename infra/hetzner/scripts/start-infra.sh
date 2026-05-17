#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

mkdir -p data/timescaledb backups/timescaledb logs
compose up -d timescaledb
