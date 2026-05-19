#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

compose run --rm --no-deps mmbot-main bun run db:migrate
