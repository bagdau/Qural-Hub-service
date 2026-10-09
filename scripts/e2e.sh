#!/usr/bin/env bash
# Запуск E2E (Playwright) против работающего стенда. Аргументы передаются в `playwright test`.
set -euo pipefail
cd "$(dirname "$0")/.."
PW="$(grep '^DEMO_USER_PASSWORD=' .env | cut -d= -f2-)"
NET="${E2E_NETWORK:-alageum_internal}"
PW_IMAGE="mcr.microsoft.com/playwright:v$(node -p "require('./frontend/package.json').devDependencies['@playwright/test']")-noble"
MSYS_NO_PATHCONV=1 docker run --rm --ipc=host --network "$NET" \
  -v "$(pwd -W 2>/dev/null || pwd)/frontend:/work" -w /work \
  -e BASE_URL=http://web:8080 -e API_URL=http://api:8000 -e E2E_PASSWORD="$PW" \
  "$PW_IMAGE" npx playwright test "$@"
