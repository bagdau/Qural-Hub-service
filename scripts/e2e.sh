#!/usr/bin/env bash
# Запуск E2E (Playwright) против работающего стенда.
#   ./scripts/e2e.sh                       — все проекты (desktop, tablet, mobile, затем scanner)
#   ./scripts/e2e.sh --project=scanner …   — только указанное (аргументы передаются в `playwright test`)
# Проект scanner выполняется в «безопасном контексте» (localhost) — камере нужен HTTPS или localhost.
# Остальные проекты ходят на http://web:8080 (небезопасный контекст — проверяется и режим без HTTPS).
set -euo pipefail
cd "$(dirname "$0")/.."
PW="$(grep '^DEMO_USER_PASSWORD=' .env | cut -d= -f2-)"
if [ ! -f frontend/e2e/fixtures/qr.y4m ]; then
  echo "Генерация тестовых изображений QR…"
  MSYS_NO_PATHCONV=1 docker run --rm -u 0 -v "$(pwd -W 2>/dev/null || pwd):/w" "alageum/backend:${APP_VERSION:-0.1.0}" python /w/scripts/make_qr_fixtures.py
fi
PW_IMAGE="mcr.microsoft.com/playwright:v$(node -p "require('./frontend/package.json').devDependencies['@playwright/test']")-noble"
MOUNT="$(pwd -W 2>/dev/null || pwd)/frontend"

run() { # $1=secure(0|1) остальное — аргументы playwright
  local secure="$1"; shift
  local net base
  if [ "$secure" = 1 ]; then net="container:$(docker compose ps -q web)"; base="http://localhost:8080"; else net="${E2E_NETWORK:-alageum_internal}"; base="http://web:8080"; fi
  MSYS_NO_PATHCONV=1 docker run --rm --ipc=host --network "$net" -v "$MOUNT:/work" -w /work \
    -e BASE_URL="$base" -e API_URL=http://api:8000 -e E2E_PASSWORD="$PW" -e FIXTURES_DIR=/work/e2e/fixtures \
    "$PW_IMAGE" npx playwright test "$@"
}

if [ "$#" -eq 0 ]; then
  rc=0
  run 0 --project=desktop --project=tablet --project=mobile || rc=$?
  run 1 --project=scanner || rc=$?
  exit $rc
elif printf '%s\n' "$@" | grep -q -- '--project=scanner'; then
  run 1 "$@"
else
  run 0 "$@"
fi
