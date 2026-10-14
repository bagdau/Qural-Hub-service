#!/usr/bin/env bash
# Самоподписанный сертификат для HTTPS в локальной сети (нужен для камеры на телефоне).
# Использование: bash scripts/make_cert.sh 192.168.1.50 [ещё_адреса...]
# Результат: certs/server.crt и certs/server.key; затем: docker compose up -d --force-recreate web
set -euo pipefail
[ $# -ge 1 ] || { echo "Укажите IP-адрес компьютера в локальной сети, например: bash scripts/make_cert.sh 192.168.1.50"; exit 1; }
cd "$(dirname "$0")/.."
mkdir -p certs
san="DNS:localhost,IP:127.0.0.1"
for ip in "$@"; do san="$san,IP:$ip"; done
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/certs:/certs" alpine:3.20 sh -c "
  apk add --no-cache openssl >/dev/null &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout /certs/server.key -out /certs/server.crt \
    -subj '/CN=Alageum Service Hub' -addext 'subjectAltName=$san' &&
  chmod 644 /certs/server.key /certs/server.crt"
echo "Готово: certs/server.crt (адреса: $san)"
