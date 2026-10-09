#!/usr/bin/env bash
# Восстановление из backup: ./scripts/restore.sh backups/<метка> [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?укажите каталог backup}"; [ -f "$SRC/db.dump" ] || { echo "Нет $SRC/db.dump"; exit 1; }
set -a; . ./.env; set +a
PROJECT="${COMPOSE_PROJECT_NAME:-alageum}"
if [ "${2:-}" != "--yes" ]; then read -r -p "ТЕКУЩИЕ данные БД и файлов будут заменены. Продолжить? [yes/N] " a; [ "$a" = "yes" ] || exit 1; fi
(cd "$SRC" && sha256sum -c <(python3 - <<'PY' 2>/dev/null || true
import json;m=json.load(open('manifest.json'))['sha256']
for k,v in m.items(): print(v+'  '+k)
PY
)) || echo "ВНИМАНИЕ: не удалось проверить контрольные суммы"
docker compose stop web api worker >/dev/null 2>&1 || true
docker compose up -d --wait db
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$SRC/db.dump"
MSYS_NO_PATHCONV=1 docker run --rm -v "${PROJECT}_files:/data" -v "$(cd "$SRC" && (pwd -W 2>/dev/null || pwd)):/backup:ro" alpine \
  sh -c "find /data -mindepth 1 -delete && tar xzf /backup/files.tar.gz -C /data"
docker compose run --rm migrate
docker compose up -d --wait
docker compose run --rm api python -m app.cli verify-storage
echo "Восстановление завершено."
