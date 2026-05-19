#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

compose pull market-data-recorder-bulk external-market-recorder mmbot-main mmbot-canary
