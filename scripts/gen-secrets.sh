#!/usr/bin/env bash
# Создаёт .env из .env.example и подставляет случайные секреты (без вывода значений).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
rand() { python3 - <<'PY' 2>/dev/null || openssl rand -base64 24 | tr -d '/+=' | cut -c1-32
import secrets, string
print(''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(32)))
PY
}
set_var() { # $1=name
  if grep -qE "^$1=\s*(#.*)?$" .env; then
    val="$(rand)"
    sed -i.bak -E "s|^$1=\s*(#.*)?$|$1=$val|" .env && rm -f .env.bak
    echo "  + $1 сгенерирован"
  else
    echo "  = $1 уже задан"
  fi
}
for v in POSTGRES_PASSWORD SECRET_KEY DEMO_USER_PASSWORD; do set_var "$v"; done
echo "Готово: проверьте .env (APP_ENV, ALLOW_DEMO_SEED)."
