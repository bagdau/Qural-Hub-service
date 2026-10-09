#!/usr/bin/env bash
# Backup: дамп БД (pg_dump -Fc) + том files + manifest.json. Порядок: сначала БД, затем файлы (раздел 11.9).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
PROJECT="${COMPOSE_PROJECT_NAME:-alageum}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="${BACKUP_DIR:-./backups}/$TS"
mkdir -p "$DIR"
docker compose exec -T db pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$DIR/db.dump"
MSYS_NO_PATHCONV=1 docker run --rm -v "${PROJECT}_files:/data:ro" -v "$(cd "$DIR" && (pwd -W 2>/dev/null || pwd)):/backup" alpine \
  sh -c "tar czf /backup/files.tar.gz -C /data . && ls /data | head -1 >/dev/null"
REV="$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'select version_num from alembic_version')"
TICKETS="$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'select count(*) from tickets')"
cat > "$DIR/manifest.json" <<JSON
{"created_at_utc":"$TS","app_version":"${APP_VERSION:-unknown}","alembic_revision":"$REV","tickets":$TICKETS,
 "sha256":{"db.dump":"$(sha256sum "$DIR/db.dump" | cut -d' ' -f1)","files.tar.gz":"$(sha256sum "$DIR/files.tar.gz" | cut -d' ' -f1)"}}
JSON
echo "Backup создан: $DIR"
