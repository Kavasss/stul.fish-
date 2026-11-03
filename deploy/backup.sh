#!/usr/bin/env bash
# Резервная копия базы и фото SHUL.FISH. Хранит копии за 14 дней.
set -euo pipefail
DATA_DIR=/var/lib/shulfish
BACKUP_DIR=/var/backups/shulfish
STAMP="$(date +%Y-%m-%d_%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT

# Согласованная копия базы даже во время работы сайта
sqlite3 "$DATA_DIR/shop.db" ".backup '$TMP/shop.db'"
tar -czf "$BACKUP_DIR/shulfish-$STAMP.tar.gz" -C "$TMP" shop.db -C "$DATA_DIR" uploads
chmod 600 "$BACKUP_DIR/shulfish-$STAMP.tar.gz"
find "$BACKUP_DIR" -name 'shulfish-*.tar.gz' -mtime +14 -delete
echo "Копия: $BACKUP_DIR/shulfish-$STAMP.tar.gz"
