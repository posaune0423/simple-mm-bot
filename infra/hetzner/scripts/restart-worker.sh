#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

compose up -d --no-deps --force-recreate market-data-recorder-bulk
