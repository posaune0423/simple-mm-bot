#!/usr/bin/env bash
set -euo pipefail
umask 077

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

backup_dir="${BACKUP_DIR:-$ROOT_DIR/backups/timescaledb}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
if ! [[ "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a non-negative integer: $retention_days" >&2
  exit 1
fi
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/mm_bot-$timestamp.sql.gz"
tmp_backup_path="$backup_path.tmp"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
trap 'rm -f "$tmp_backup_path"' EXIT
compose exec -T timescaledb pg_dump -U mm -d mm_bot | gzip > "$tmp_backup_path"
chmod 600 "$tmp_backup_path"
mv "$tmp_backup_path" "$backup_path"
trap - EXIT
find "$backup_dir" -type f -name 'mm_bot-*.sql.gz' -mtime +"$retention_days" -delete
echo "$backup_path"
