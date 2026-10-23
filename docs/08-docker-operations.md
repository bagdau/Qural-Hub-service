# Раздел 11. Docker и эксплуатация

> Всё ниже — **контракт будущей реализации**. Файлов `compose.yaml`, `Dockerfile`, `scripts/*` в репозитории пока нет; команды появятся и будут проверены на этапе 2 и дополнены на этапе 10. Имена сервисов, профилей, скриптов и переменных считаются зафиксированными, чтобы разработчики и AI-агент могли на них ссылаться.

## 11.1. Состав контейнеров

| Сервис | Образ / сборка | Назначение | Команда | Порты на хост | Перезапуск | Профиль |
|---|---|---|---|---|---|---|
| `db` | `postgres:<major>-alpine@sha256:…` (ДП: версия по 2.2) | PostgreSQL | стандартная | **нет** | `unless-stopped` | — |
| `migrate` | `backend` (общий образ) | Применить миграции Alembic и завершиться | `alembic upgrade head` | нет | `"no"` | — |
| `api` | `backend` | FastAPI | `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers` | **нет** (только внутренняя сеть) | `unless-stopped` | — |
| `worker` | `backend` | Планировщик: плановые заявки, проверки SLA, очистка, сверка файлов | `python -m app.worker` | нет | `unless-stopped` | — |
| `web` | `frontend` (Nginx + собранный SPA) | Раздача SPA, TLS, прокси `/api` | nginx | `80:8080`, `443:8443` | `unless-stopped` | — |
| `seed` | `backend` | Загрузить demo-данные и завершиться | `python -m app.cli seed-demo` | нет | `"no"` | `demo` |
| `backup` (SHOULD) | `postgres:<major>-alpine` + утилиты | Периодический backup по расписанию | `scripts/backup-loop.sh` | нет | `unless-stopped` | `backup` |

`worker` нужен, потому что в системе есть периодические задачи (генерация плановых заявок, SLA-уведомления, очистка сессий/уведомлений/осиротевших файлов, напоминания). Отдельная очередь не нужна (2.4). Одновременно допускается один активный экземпляр: задачи берут PostgreSQL advisory-lock и пишут в `job_runs`.

Образ `backend` **один** и используется `migrate`, `api`, `worker`, `seed`; различаются команды. Это гарантирует, что миграции и приложение собраны из одного кода.

## 11.2. Сети и тома

| Объект | Тип | Подключены | Примечание |
|---|---|---|---|
| `edge` | bridge | `web` | Единственная сеть с публикацией портов на хост |
| `internal` | bridge, `internal: true` | `db`, `migrate`, `api`, `worker`, `seed`, `backup`, `web` | Без доступа в интернет и без публикации портов; `web` подключён к обеим сетям |
| `pgdata` | named volume | `db` → `/var/lib/postgresql/data` | Данные БД; `docker compose down` его **не удаляет** |
| `files` | named volume | `api`, `worker`, `seed`, `backup` (только чтение) → `/var/lib/alageum/files` | Приватное хранилище вложений и актов; `web` его **не монтирует** |
| `backups` | bind-mount `${BACKUP_DIR}` | `backup` | Каталог на хосте, права `700` |
| `certs` | bind-mount `${TLS_DIR}` (ro) | `web` | `fullchain.pem`, `privkey.pem` |

## 11.3. Переменные окружения

Файл `.env.example` (в Git) содержит только **безопасные заглушки и комментарии**; `.env` — в `.gitignore`. Секреты в pilot — через файлы (`*_FILE`).

| Переменная | Пример/по умолчанию | Описание | Секрет |
|---|---|---|---|
| `COMPOSE_PROJECT_NAME` | `alageum` | Префикс ресурсов | нет |
| `APP_VERSION` | `0.1.0` | Тег образов `alageum/api:${APP_VERSION}` | нет |
| `APP_ENV` | `dev` \| `test` \| `demo` \| `pilot` | Режим: определяет докс, cookie, разрешён ли demo-seed | нет |
| `APP_PUBLIC_URL` | `https://hub.example.test` | База ссылок в QR и уведомлениях | нет |
| `APP_TIMEZONE_DEFAULT` | `Asia/Almaty` | Часовой пояс отображения по умолчанию | нет |
| `APP_CLOCK_MODE` | `system` (pilot), `fixed`/`shifted` (demo, test) | Источник времени | нет |
| `APP_FIXED_NOW` | `2026-03-16T10:00:00Z` | Для `fixed`/`shifted` | нет |
| `POSTGRES_DB`, `POSTGRES_USER` | `alageum`, `alageum_app` | | нет |
| `POSTGRES_PASSWORD_FILE` | `/run/secrets/db_password` | Пароль БД (в dev допускается `POSTGRES_PASSWORD`) | **да** |
| `DATABASE_URL` | собирается приложением из `POSTGRES_*` | | нет |
| `SECRET_KEY_FILE` | `/run/secrets/secret_key` | Перец для хэшей токенов сессий; смена = выход всех | **да** |
| `COOKIE_SECURE` | `true` (кроме dev) | | нет |
| `SESSION_IDLE_TTL_MINUTES`, `SESSION_ABS_TTL_MINUTES` | `10`, `480` | Выход после N минут без действий (любая активность продлевает сеанс) и абсолютный предел сеанса | нет |
| `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES` | `5`, `15` | | нет |
| `TEMP_PASSWORD_TTL_HOURS` | `72` | | нет |
| `FILES_DIR` | `/var/lib/alageum/files` | | нет |
| `MAX_PHOTO_MB`, `MAX_DOC_MB`, `MAX_ATTACHMENTS_PER_TICKET` | `10`, `20`, `40` | | нет |
| `WORKER_ENABLED` | `true` | | нет |
| `TRUSTED_PROXY_CIDRS` | `172.16.0.0/12` | Откуда доверять `X-Forwarded-*` | нет |
| `LOG_LEVEL`, `LOG_FORMAT` | `INFO`, `json` | | нет |
| `ALLOW_DEMO_SEED` | `false` | Демо-загрузка разрешена только при `true` и `APP_ENV ∈ {dev, test, demo}` | нет |
| `DEMO_USER_PASSWORD_FILE` | `/run/secrets/demo_password` | Пароль всех demo-пользователей (≥ 12 символов); без него seed не стартует | **да** |
| `WEB_HTTP_PORT`, `WEB_HTTPS_PORT` | `80`, `443` | | нет |
| `TLS_DIR` | `./certs` | Каталог сертификатов | путь |
| `BACKUP_DIR` | `/srv/alageum/backups` | | путь |
| `BACKUP_RETENTION_DAILY`, `BACKUP_RETENTION_WEEKLY` | `14`, `8` | ДП | нет |

Поведение при ошибках конфигурации: приложение **падает на старте** с понятным сообщением, если отсутствует обязательная переменная, `COOKIE_SECURE=false` при `APP_ENV=pilot`, либо `ALLOW_DEMO_SEED=true` при `APP_ENV=pilot`.

## 11.4. Зависимости запуска и healthcheck

### Что означают условия `depends_on`

| Условие | Смысл | Где используется |
|---|---|---|
| `service_started` | Контейнер запущен (процесс стартовал) — ничего не гарантирует о готовности | не используется для критических зависимостей |
| `service_healthy` | Healthcheck зависимости **прошёл** (контейнер «готов обслуживать») | `migrate` → `db`; `api` → `db`; `web` → `api` |
| `service_completed_successfully` | Зависимость — one-shot контейнер, который **завершился с кодом 0** | `api` → `migrate`; `worker` → `migrate`; `seed` → `migrate` |

### Цепочка запуска

```
db (healthy) ──► migrate (exit 0) ──► api (healthy) ──► web
                       └──────────────► worker
                       └──────────────► seed (профиль demo)
```

* Если `migrate` завершился с ошибкой (код ≠ 0), Compose **не запускает** `api`, `worker`, `seed`: команда `docker compose up` завершается ошибкой «dependency failed to start», старая схема БД остаётся нетронутой (миграции транзакционны, где это возможно). Это защищает от запуска нового кода на старой схеме.
* `web` стартует после здорового `api`, поэтому пользователь не увидит 502 при штатном запуске.

### Healthcheck-и

| Сервис | Проверка | interval / timeout / retries / start_period |
|---|---|---|
| `db` | `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` | 5 с / 5 с / 12 / 10 с |
| `api` | Python-однострочник: `GET http://127.0.0.1:8000/api/v1/health/ready` → код 200 (в образе нет `curl`) | 10 с / 5 с / 5 / 30 с |
| `worker` | Файл-heartbeat `/tmp/worker.heartbeat` обновлялся не более 120 с назад | 30 с / 5 с / 3 / 30 с |
| `web` | `wget -qO- http://127.0.0.1:8080/healthz` (локальный `location` Nginx без проксирования) | 10 с / 3 с / 3 / 5 с |

### Устойчивость после перезагрузки сервера

Политика `restart: unless-stopped` перезапускает контейнеры независимо от `depends_on`. Поэтому `api` и `worker` **обязаны** переживать недоступность БД на старте: повторять подключение с экспоненциальной задержкой до 60 с и только затем завершаться с ошибкой (после чего политика перезапустит их снова). `migrate` после перезагрузки не запускается (`restart: "no"`, схема уже актуальна), `/health/ready` проверяет, что `alembic_version` = head ожидаемой версии.

### Эскиз `compose.yaml` (контрактный, без значений секретов)

```yaml
name: alageum
x-logging: &default-logging
  driver: json-file
  options: { max-size: "10m", max-file: "5" }

services:
  db:
    image: postgres:<major>-alpine@sha256:<digest>
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets: [db_password]
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s
    logging: *default-logging

  migrate:
    image: alageum/backend:${APP_VERSION}
    build: { context: ./backend, target: runtime }
    command: ["alembic", "upgrade", "head"]
    restart: "no"
    depends_on:
      db: { condition: service_healthy }
    networks: [internal]

  api:
    image: alageum/backend:${APP_VERSION}
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    volumes: [files:/var/lib/alageum/files]
    networks: [internal]
    healthcheck: { test: ["CMD", "python", "-c", "…readiness probe…"], interval: 10s, timeout: 5s, retries: 5, start_period: 30s }

  worker:    # тот же образ, command: python -m app.worker, depends_on: db healthy + migrate completed
  seed:      # profiles: ["demo"], command: python -m app.cli seed-demo, restart: "no"

  web:
    image: alageum/frontend:${APP_VERSION}
    build: { context: ./frontend }
    restart: unless-stopped
    depends_on:
      api: { condition: service_healthy }
    ports: ["${WEB_HTTP_PORT}:8080", "${WEB_HTTPS_PORT}:8443"]
    volumes: ["${TLS_DIR}:/etc/nginx/certs:ro"]
    networks: [edge, internal]

networks:
  edge: {}
  internal: { internal: true }
volumes: { pgdata: {}, files: {} }
secrets:
  db_password: { file: ./secrets/db_password.txt }
```

## 11.5. Dockerfile backend (требования)

| Требование | Реализация |
|---|---|
| Многоэтапная сборка | Этап `builder`: устанавливает зависимости из lock-файла **с проверкой хэшей** в виртуальное окружение; этап `runtime`: копирует окружение и код; этап `test` (наследует `runtime` + dev-зависимости) для CI |
| Базовый образ | `python:<ver>-slim` с закреплением по digest |
| Системные пакеты | Только необходимые для WeasyPrint и шрифтов: Pango/Cairo-зависимости, `fonts-noto-core`/`fonts-dejavu-core` (кириллица, казахские буквы); `apt-get install --no-install-recommends`, очистка кэша `apt` |
| Пользователь | Не root: `uid 10001`, домашняя папка отсутствует; каталог файлов принадлежит этому пользователю |
| Переменные | `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`, `PIP_NO_CACHE_DIR=1` |
| Init-процесс | `tini` как `ENTRYPOINT` (корректные сигналы, отсутствие зомби) |
| Корневая ФС | Совместим с `read_only: true` (временные файлы — `tmpfs: /tmp`) |
| Метаданные | `LABEL org.opencontainers.image.version/revision/source` из build-args (`APP_VERSION`, `GIT_SHA`) — без секретов |
| Размер | Цель ≤ 600 МБ (WeasyPrint и шрифты), измеряется в CI |
| Сканирование | `trivy image` или аналог в CI — вывод в отчёт (ошибка при critical с исправлением) |
| Миграции | Включены в образ (`alembic.ini`, `migrations/`) |

## 11.6. Frontend: многоэтапная сборка и Nginx

| Этап | Действия |
|---|---|
| `build` (образ Node, закреплён) | `COPY package.json package-lock.json` → `npm ci` → `COPY src …` → `npm run build` (`tsc --noEmit` + `vite build`). Публичные переменные только `VITE_*`; секретов нет. Артефакт: `dist/` |
| `runtime` (`nginx-unprivileged`, закреплён) | Копирует `dist/` в `/usr/share/nginx/html`, `nginx.conf` и `security-headers.conf`; node-модули и исходники в образ **не попадают** |

Требования к `nginx.conf`:

| Область | Правило |
|---|---|
| Порты | 8080 (HTTP: редирект на HTTPS в pilot, `healthz`) и 8443 (TLS) внутри контейнера |
| SPA | `location / { try_files $uri /index.html; }`; ассеты с хэшем — `Cache-Control: public, max-age=31536000, immutable`; `index.html` — `no-cache` |
| API | `location /api/ { proxy_pass http://api:8000; proxy_set_header X-Forwarded-For/Proto/Host; proxy_read_timeout 60s; client_max_body_size 25m; }` |
| Лимиты | `limit_req_zone` для `/api/v1/auth/login` ≤ 10 запросов/мин с IP (burst 5), общий лимит ≤ 20 запросов/с с IP (burst 40) |
| Файлы | Nginx **не** обслуживает каталог файлов; выдача только через API |
| Заголовки | CSP (`default-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'`; для PDF-просмотра `frame-src 'self'`/`object-src 'self'`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: camera=(self)`, `Strict-Transport-Security` (после проверки HTTPS) |
| Сжатие | gzip для текстовых типов |
| Версия | `server_tokens off` |
| Журналы | В stdout/stderr (формат JSON без cookie и без query-параметров с токенами) |

## 11.7. `.dockerignore`, режимы и файлы Compose

**`.dockerignore` (backend и frontend, по отдельности):** `.git`, `.github`, `.env*`, `secrets/`, `backups/`, `docs/`, `*.md` (кроме нужных), `**/__pycache__`, `.venv`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`, `*.log`. Для backend исключаются каталоги `tests/` из `runtime`-контекста (они копируются только на этапе `test`).

| Файл | Назначение | Запуск |
|---|---|---|
| `compose.yaml` | База, безопасная по умолчанию: без публикации БД, без dev-монтирований, healthcheck, лимиты логов | всегда |
| `compose.dev.yaml` | Разработка: bind-mount исходников, `uvicorn --reload`, Vite dev-server с прокси `/api`, публикация БД на `127.0.0.1:5432`, `APP_ENV=dev`, `COOKIE_SECURE=false`, включён Swagger | `docker compose -f compose.yaml -f compose.dev.yaml up` (обёртка `make dev`) |
| `compose.pilot.yaml` | Пилот: Docker secrets, `read_only: true`, TLS-сертификаты, `APP_ENV=pilot`, Swagger выключен, `seed` исключён (`profiles: ["never"]`), `ALLOW_DEMO_SEED=false` принудительно, профиль `backup` | `docker compose -f compose.yaml -f compose.pilot.yaml up -d` (обёртка `make pilot-up`) |
| `compose.test.yaml` | Тесты (11.12) | `-p alageum-test` |

Авто-подхватываемый `compose.override.yaml` **не используется** — иначе dev-настройки могли бы случайно оказаться на пилотном сервере.

## 11.8. Целевые команды (контракт)

**Первоначальная настройка**

```bash
git clone <repo-url> qural-hub && cd qural-hub
cp .env.example .env
./scripts/gen-secrets.sh        # создаёт secrets/*.txt (права 600) со случайными значениями
```

**Сборка и запуск (demo / разработка)**

```bash
docker compose build
docker compose up -d --wait    # db → migrate → api → web; ожидание healthy
```

**Миграции** (применяются автоматически сервисом `migrate`; вручную:)

```bash
docker compose run --rm migrate                         # alembic upgrade head
docker compose run --rm migrate alembic current         # текущая ревизия
docker compose run --rm migrate alembic history --verbose
```

**Создание администратора** (пароль запрашивается интерактивно, в историю оболочки не попадает)

```bash
docker compose run --rm api python -m app.cli create-admin --email admin@example.org --full-name "Администратор"
```

**Загрузка demo** (только `APP_ENV ∈ {dev, test, demo}` и `ALLOW_DEMO_SEED=true`)

```bash
docker compose --profile demo run --rm seed
```

**Просмотр логов**

```bash
docker compose logs -f --tail=200 api worker web
docker compose ps
```

**Тестирование**

```bash
docker compose -f compose.yaml -f compose.test.yaml run --rm backend-tests      # pytest
docker compose -f compose.yaml -f compose.test.yaml run --rm frontend-tests     # vitest
docker compose -f compose.yaml -f compose.test.yaml --profile e2e up --abort-on-container-exit --exit-code-from e2e
```

**Остановка без удаления данных**

```bash
docker compose stop            # остановить, контейнеры и тома сохраняются
docker compose down            # удалить контейнеры и сети; тома (pgdata, files) СОХРАНЯЮТСЯ
# ОПАСНО, удаляет данные: docker compose down -v  — в документации и Makefile не используется, только в тестовом проекте
```

**Backup и restore**

```bash
./scripts/backup.sh                                  # создаёт backups/<UTC-метка>/{db.dump,files.tar.gz,manifest.json}
./scripts/restore.sh backups/20260316T100000Z        # восстановление (запрашивает подтверждение)
./scripts/verify-backup.sh backups/20260316T100000Z  # проверка хэшей и целостности без восстановления
```

**Обновление и откат**

```bash
./scripts/backup.sh
git fetch --tags && git checkout v0.2.0
docker compose -f compose.yaml -f compose.pilot.yaml build
docker compose -f compose.yaml -f compose.pilot.yaml up -d --wait   # migrate выполняется до api
./scripts/smoke.sh                                                   # health, вход, список заявок

# откат кода (если миграции совместимы — см. 7.11 expand/contract)
git checkout v0.1.0 && docker compose -f compose.yaml -f compose.pilot.yaml up -d --wait
# откат данных (если схема несовместима)
./scripts/restore.sh backups/<метка перед обновлением>
```

## 11.9. Backup и восстановление

| Тема | Правило |
|---|---|
| Что копируется | Дамп БД (`pg_dump -Fc`) + том `files` (tar.gz) + `manifest.json` (время UTC, версия приложения, ревизия Alembic, размеры, SHA-256 каждого файла архива, число заявок/вложений/актов) |
| Порядок | 1) дамп БД; 2) затем архив файлов. Файлы удаляются физически только через 30 дней после мягкого удаления, поэтому всё, на что ссылается дамп, существует в более позднем архиве файлов (консистентное надмножество); лишние файлы приводят только к «сиротам», которые очищаются |
| Периодичность | Пилот: ежедневно (профиль `backup` или cron хоста) — **RPO цели ≤ 24 ч** (ДП); перед каждым обновлением — обязательно |
| Хранение | 14 ежедневных + 8 еженедельных (ДП); минимум одна копия **вне сервера** (внешний диск/другой хост); права на каталог `700`; шифрование копий (`age`/GPG) — рекомендуется |
| Проверка | `verify-backup.sh`: хэши, `pg_restore --list`; ежемесячное **тестовое восстановление** в изолированный проект (OP-04). **RTO цель ≤ 4 ч** (ДП) |
| Восстановление | `restore.sh`: 1) подтверждение; 2) `docker compose stop web api worker`; 3) пересоздание БД и `pg_restore`; 4) очистка и распаковка `files`; 5) `docker compose run --rm migrate` (догоняет схему, если дамп старее кода); 6) `up -d --wait`; 7) `python -m app.cli verify-storage`; 8) смоук-проверка |

## 11.10. HTTPS

| Вариант | Когда | Особенности |
|---|---|---|
| Публичный домен + Let's Encrypt | Сервер доступен из интернета/имеет DNS-имя | Выпуск через `certbot` (HTTP-01 через `/.well-known/acme-challenge/` или DNS-01); автообновление задачей хоста; после обновления `docker compose exec web nginx -s reload` |
| Сертификат корпоративного CA | Пилот во внутренней сети компании | Корневой CA установлен на устройствах инженеров (MDM/вручную); сертификат выдаёт ИТ компании |
| Самоподписанный / `mkcert` | Только dev и локальная демонстрация | Устройства должны доверять CA; иначе предупреждения браузера, а возможности (камера в браузере) могут быть ограничены — проверяется в OP-07 |

Общее: TLS 1.2+ (предпочтительно 1.3), современные наборы шифров по умолчанию Nginx stable, редирект HTTP→HTTPS в pilot, HSTS (`max-age` 6 месяцев) включается после успешной проверки, `Secure` cookie, пересоздание QR при смене домена **не требуется**, если домен сохранён (в QR зашит `APP_PUBLIC_URL`); при смене домена нужна печать новых этикеток или редирект со старого домена — указывается в руководстве.

## 11.11. Секреты, приватность, журналы, восстановление

| Тема | Требование |
|---|---|
| Секреты | Не в Git, не в образах и build-args, не в логах. Dev: `.env`. Pilot: Docker secrets-файлы `secrets/*.txt` (`chmod 600`, владелец — администратор хоста). Приложение читает `*_FILE`. Ротация: пароль БД (смена в БД + файл + перезапуск `api/worker`), `SECRET_KEY` (все сессии аннулируются), демо-пароль — только demo |
| Приватность БД | Порт 5432 не публикуется; доступ только из сети `internal`; роли `app_rw` / `app_migrator`; администрирование — `docker compose exec db psql` |
| Приватность файлов | Том `files` не монтируется в `web`; нет публичных URL; имена файлов случайны; скачивание — только через API с проверкой прав; права каталога `700` |
| Шифрование | Рекомендуется шифрование диска хоста и резервных копий (ДП) |
| Логи приложения | JSON в stdout: `ts`, `level`, `request_id`, `user_id`, `method`, `path` (без query-параметров с токенами), `status`, `duration_ms`; запрещено логировать пароли, токены, cookie, содержимое файлов |
| Ротация логов | Драйвер `json-file`, `max-size: 10m`, `max-file: 5` на каждый сервис (якорь `x-logging`); при использовании `journald` — настройки хоста |
| Аудит | `audit_log` в БД хранится ≥ 12 месяцев (ДП); не удаляется приложением |
| Восстановление | Автозапуск Docker при загрузке (`systemctl enable docker`), `restart: unless-stopped`, устойчивость `api/worker` к старту БД (11.4), проверка после перезагрузки `scripts/status.sh` (контейнеры, health, свободный диск, возраст последнего backup) |
| Время | Хост синхронизируется по NTP; расхождение критично для SLA и срока сессий |
| Диск | Предупреждение при заполнении > 80% (`status.sh`, cron-уведомление администратору) |
| Обновления безопасности | Пересборка образов не реже раза в месяц (обновление базового образа и зависимостей по lock-файлам), отчёт `pip-audit`/`npm audit`/`trivy` |

## 11.12. Тестовое окружение

`compose.test.yaml` запускается в отдельном проекте (`-p alageum-test`) и не затрагивает данные разработки/пилота.

| Сервис | Особенности |
|---|---|
| `db-test` | PostgreSQL на `tmpfs` (быстро, без следов), отдельный пароль, без публикации портов |
| `backend-tests` | Цель Docker `test`; `APP_ENV=test`, `APP_CLOCK_MODE=fixed`; миграции применяются фикстурой на чистую БД; изоляция тестов — транзакция с откатом либо очистка таблиц; файлы — во временном каталоге |
| `frontend-tests` | Vitest в контейнере Node (без браузера) |
| `api-test`, `web-test` | Поднимаются для E2E с demo-данными (`seed`), часы `fixed` на `T0` |
| `e2e` (профиль `e2e`) | Образ Playwright той же версии, что npm-пакет; отчёт и трассировки сохраняются в `./test-results` |
| Очистка | `docker compose -p alageum-test down -v` (удаление томов допустимо **только** в тестовом проекте) |

## 11.13. Критерии приёмки раздела

| № | Критерий | Проверка |
|---|---|---|
| 11-1 | Чистая машина с Docker: по README за ≤ 15 минут (без учёта загрузки образов) поднимаются `db → migrate → api → web`, открывается страница входа | OP-01 |
| 11-2 | Падение `migrate` (искусственная битая миграция) не запускает `api` | OP-05 |
| 11-3 | После `docker compose down` + `up` и после перезагрузки хоста данные БД и файлы на месте | OP-02 |
| 11-4 | Backup → пустой стенд → restore → данные и файлы идентичны (хэши) | OP-03, OP-04 |
| 11-5 | Demo-seed не запускается при `APP_ENV=pilot` и при `deployment_mode=pilot` в `app_meta` | OP-06 |
| 11-6 | Порт БД и каталог файлов недоступны снаружи | OP-10 |
| 11-7 | Логи ротируются (проверка настроек и размера после нагрузки) | OP-08 |
| 11-8 | Обновление и откат на репетиции выполняются по инструкции без ручной правки данных | OP-09 |
