#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

compose pull market-data-recorder-bulk mmbot-main mmbot-canary
