#!/usr/bin/env bash
# Установка магазина SHUL.FISH на чистый сервер Ubuntu 22.04 / 24.04 или Debian 12.
# Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/Kavasss/stul.fish-/claude/zen-wright-u8psjn/deploy/install.sh | bash
# Повторный запуск безопасен: обновит код и перезапустит сайт, данные не трогает.
set -euo pipefail

DOMAIN="${DOMAIN:-shulfish.pl}"
REPO="${REPO:-https://github.com/Kavasss/stul.fish-.git}"
BRANCH="${BRANCH:-claude/zen-wright-u8psjn}"
APP_DIR=/opt/shulfish
DATA_DIR=/var/lib/shulfish
ENV_DIR=/etc/shulfish
BACKUP_DIR=/var/backups/shulfish

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите от root (sudo -i)"
command -v apt-get >/dev/null || die "нужен Ubuntu или Debian"

say "Устанавливаю системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl git ca-certificates gnupg sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https

say "Node.js 22"
need_node=1
if command -v node >/dev/null; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "нужен Node.js 22.13 или новее, установлен $(node -v)"
echo "Node.js $(node -v)"

say "Caddy (веб-сервер с автоматическим HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

say "Пользователь и папки"
id shulfish >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin shulfish
install -d -o shulfish -g shulfish -m 750 "$DATA_DIR"
install -d -o root -g root -m 700 "$ENV_DIR" "$BACKUP_DIR"

say "Код магазина ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR" \
    || die "не удалось скачать код. Если репозиторий приватный, используйте REPO=https://<токен>@github.com/Kavasss/stul.fish-.git"
fi
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"

say "Настройки ($ENV_DIR/shulfish.env)"
if [ ! -f "$ENV_DIR/shulfish.env" ]; then
  SHEETS_SECRET_SUGGEST="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
  cat > "$ENV_DIR/shulfish.env" <<EOF
# Настройки магазина. После правки: systemctl restart shulfish
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA_DIR
COOKIE_SECURE=1
TRUST_PROXY=1
ALLOWED_HOSTS=$DOMAIN,www.$DOMAIN

# Связь с Google Таблицей — раскомментируйте после развёртывания Apps Script.
# Этот же секрет впишите в SECRET в Code.gs:
#SHEETS_SECRET=$SHEETS_SECRET_SUGGEST
#SHEETS_WEBAPP_URL=https://script.google.com/macros/s/.../exec
EOF
  chmod 600 "$ENV_DIR/shulfish.env"
fi

say "Служба автозапуска"
install -m 644 "$APP_DIR/deploy/shulfish.service" /etc/systemd/system/shulfish.service
systemctl daemon-reload
systemctl enable -q shulfish
systemctl restart shulfish

say "HTTPS для $DOMAIN"
sed "s/shulfish\.pl/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable -q caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

say "Ежедневные резервные копии (03:30, хранятся 14 дней)"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/shulfish-backup
echo "30 3 * * * root /usr/local/bin/shulfish-backup >/dev/null 2>&1" > /etc/cron.d/shulfish-backup

say "Файрвол: открыты только SSH, 80 и 443"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

say "Проверка"
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:3000/api/meta" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:3000/api/meta" >/dev/null || { journalctl -u shulfish -n 30 --no-pager; die "сайт не запустился"; }
echo "Сайт работает на сервере."

MY_IP="$(curl -4 -fsS https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
if [ -n "$MY_IP" ] && [ "$MY_IP" != "$DNS_IP" ]; then
  printf '\n\033[1;33m⚠ DNS: %s сейчас указывает на «%s», а IP этого сервера — %s.\033[0m\n' "$DOMAIN" "${DNS_IP:-никуда}" "$MY_IP"
  echo "  У регистратора домена создайте A-записи:  $DOMAIN → $MY_IP  и  www.$DOMAIN → $MY_IP"
  echo "  Сертификат HTTPS выпустится сам в течение нескольких минут после обновления DNS."
else
  echo "DNS в порядке: $DOMAIN → $MY_IP"
fi

if [ -f "$DATA_DIR/FIRST-LOGIN.txt" ]; then
  printf '\n\033[1;32m%s\033[0m\n' "$(cat "$DATA_DIR/FIRST-LOGIN.txt")"
  echo "Файл: $DATA_DIR/FIRST-LOGIN.txt — удалите его после смены паролей."
fi
printf '\n\033[1;32mГотово: https://%s\033[0m\n' "$DOMAIN"
echo "Обновить сайт позже: запустите эту же команду ещё раз."
