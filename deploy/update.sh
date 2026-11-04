#!/usr/bin/env bash
# Автообновление SHUL.FISH: забирает новую версию из GitHub, делает копию базы,
# перезапускает сайт и, если он не поднялся, возвращает прошлую версию.
# Запускается таймером shulfish-update.timer (раз в 5 минут) или вручную: shulfish-update
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/shulfish}"
LOG_TAG=shulfish-update
log() { logger -t "$LOG_TAG" -- "$*"; echo "$*"; }

cd "$APP_DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$BRANCH"
OLD="$(git rev-parse HEAD)"
NEW="$(git rev-parse "origin/$BRANCH")"
[ "$OLD" = "$NEW" ] && exit 0
# версия, на которой сайт уже не поднялся, повторно не ставится — ждём следующей правки
BAD_FILE="$APP_DIR/.git/shulfish-bad-commit"
[ -f "$BAD_FILE" ] && [ "$(cat "$BAD_FILE")" = "$NEW" ] && exit 0

log "Обновление $BRANCH: ${OLD:0:7} → ${NEW:0:7}"
"${BACKUP_BIN:-/usr/local/bin/shulfish-backup}" >/dev/null || log "⚠ резервная копия не сделана"

apply() {
  git checkout -q -B "$BRANCH" "$1"
  chown -R root:root "$APP_DIR"; chmod -R go-w "$APP_DIR"
  install -m 644 deploy/shulfish.service /etc/systemd/system/shulfish.service
  install -m 755 deploy/backup.sh /usr/local/bin/shulfish-backup
  install -m 755 deploy/update.sh /usr/local/bin/shulfish-update
  systemctl daemon-reload
  systemctl restart shulfish
}
healthy() {
  for _ in $(seq 1 20); do
    curl -fsS http://127.0.0.1:3000/api/meta >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

apply "$NEW"
if healthy; then
  log "Готово: сайт работает на ${NEW:0:7}"
else
  log "❌ Сайт не поднялся на ${NEW:0:7} — возвращаю ${OLD:0:7}"
  echo "$NEW" > "$BAD_FILE"
  apply "$OLD"
  healthy && log "Откат выполнен, сайт работает" || log "❌ Сайт не работает и после отката — нужна проверка"
  exit 1
fi
