#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

backup_dir="${BACKUP_DIR:-$ROOT_DIR/backups/timescaledb}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/mm_bot-$timestamp.sql.gz"

mkdir -p "$backup_dir"
compose exec -T timescaledb pg_dump -U mm -d mm_bot | gzip > "$backup_path"
find "$backup_dir" -type f -name 'mm_bot-*.sql.gz' -mtime +"$retention_days" -delete
echo "$backup_path"
