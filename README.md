# Alageum Service Hub (MVP)

Веб-платформа учёта электротехнического оборудования и сервисного обслуживания: клиент → диспетчер → инженер → руководитель.
Проект предлагается студенческой командой Университета имени М. Әуезова для **возможного** пилота; сотрудничество с компанией **не подтверждено**, все данные — синтетические.

Стек: FastAPI + SQLAlchemy/Alembic + PostgreSQL · React + TypeScript + Vite · Nginx · Docker Compose · pytest/HTTPX · Vitest · Playwright.
Полное ТЗ — в [docs/](docs/README.md); что реализовано и чем отличается от ТЗ — [docs/12-implementation-status.md](docs/12-implementation-status.md).

## Запуск (demo)

Нужны Docker и Docker Compose.

```bash
./scripts/gen-secrets.sh                 # создаёт .env и случайные секреты
docker compose build
docker compose up -d --wait              # db → migrate → api → worker → web
docker compose --profile demo run --rm seed   # demo-данные (только APP_ENV=demo/dev/test)
```

Откройте http://localhost:8100. Пароль всех demo-пользователей — значение `DEMO_USER_PASSWORD` из `.env`.

| Роль | Email |
|---|---|
| Администратор | admin@demo.alageum.test |
| Диспетчер | dispatcher@demo.alageum.test |
| Руководитель | manager@demo.alageum.test |
| Инженеры | engineer1@demo.alageum.test, engineer2@demo.alageum.test |
| Клиенты | client.metal@…, client.agro@…, client.logistics@… (`@demo.alageum.test`) |

Главный экран работы с заявками — **доска** (`/board`): канбан, список, календарь, шкала SLA, обновление в реальном времени.

Demo-время зафиксировано: `2026-03-16T10:00:00Z` (`APP_CLOCK_MODE=fixed`), на нём дашборд совпадает с ожидаемыми значениями ТЗ (раздел 12.6).
## Доступ с телефона и других устройств (локальная сеть, HTTPS)

Камера в браузере работает только по HTTPS (или на `localhost`), поэтому для телефонов поднят HTTPS-порт `8443` с самоподписанным сертификатом:

1. `bash scripts/make_cert.sh <IP_компьютера_в_сети>` — создаёт `certs/server.crt` и `certs/server.key` (в git не попадают).
2. В `.env`: `APP_PUBLIC_URL=https://<IP_компьютера>:8443` (по этому адресу будут вести QR-коды).
3. `docker compose up -d --force-recreate web api worker`.
4. Windows: разрешить входящие порты (PowerShell от администратора):
   `New-NetFirewallRule -DisplayName "Alageum" -Direction Inbound -Protocol TCP -LocalPort 8100,8443 -Action Allow -Profile Any`
5. На телефоне открыть `https://<IP_компьютера>:8443`, принять предупреждение о сертификате («Дополнительно → Продолжить») — после этого работает живая камера сканера.

Если после пересоздания `api` сайт отвечает 502 — `docker compose restart web`.

QR-коды demo: `http://localhost:8100/e/DEMOEQUIP001` … `DEMOEQUIP010`.

## Команды

```bash
docker compose logs -f --tail=200 api worker web      # логи
docker compose stop                                   # остановка без удаления данных (docker compose down тоже сохраняет тома)
./scripts/backup.sh                                   # backup → backups/<UTC-метка>/
./scripts/restore.sh backups/<метка>                  # восстановление
docker compose run --rm api python -m app.cli create-admin --email admin@example.org   # администратор (пароль запрашивается)
docker compose run --rm api python -m app.cli verify-storage                           # сверка файлов и БД
docker compose --profile demo run --rm seed python -m app.cli seed-demo --force        # пересоздать demo (стирает ВСЕ данные БД)
```

## Тесты

```bash
# backend: unit + интеграционные (отдельная БД в памяти)
docker compose -p alageum-test -f compose.yaml -f compose.test.yaml run --rm backend-tests
# frontend unit
cd frontend && npm ci && npm test
# E2E (Playwright в контейнере, против работающего стенда с demo; перед прогоном пересоздайте demo)
./scripts/e2e.sh
```

## Разработка

`docker compose -f compose.yaml -f compose.dev.yaml up -d` — исходники backend монтируются, API на `127.0.0.1:8000`, БД на `127.0.0.1:5432`.
Frontend: `cd frontend && npm ci && npm run dev` (прокси на `http://localhost:8000`).
Версии зафиксированы: Python — `backend/requirements.lock`, JS — `frontend/package-lock.json` (точные версии, `save-exact`).
