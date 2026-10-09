# Раздел 8. REST API (FastAPI, префикс `/api/v1`)

## 8.1. Общие соглашения

| Тема | Правило |
|---|---|
| Базовый путь | `/api/v1`. OpenAPI: `/api/v1/openapi.json`, Swagger UI `/api/v1/docs` — **только в `dev`/`test`/`demo`**, в `pilot` отключены |
| Формат | JSON, UTF-8, `Content-Type: application/json`; загрузка файлов — `multipart/form-data` |
| Аутентификация | Cookie `ash_session` (HttpOnly, Secure, SameSite=Lax). Заголовок `Authorization` не используется |
| CSRF | Для `POST/PUT/PATCH/DELETE` обязателен `X-CSRF-Token` (значение из `/auth/login` или `/auth/me`); иначе `403 CSRF_FAILED` |
| Идемпотентность | Заголовок `Idempotency-Key: <uuid v4>` — **обязателен** там, где указано «Idem» (5.9) |
| Идентификатор запроса | Клиент может передать `X-Request-Id` (uuid); иначе генерируется; возвращается в заголовке и в теле ошибки |
| Время | ISO 8601 UTC, `2026-03-16T10:00:00Z` |
| Идентификаторы | UUID; в путях — как есть |
| Версии | В теле изменяющих запросов — поле `version` (число из последнего ответа) |
| Права | Колонка «Роли»: **A**=admin, **D**=dispatcher, **E**=engineer, **M**=manager, **C**=client, `*`=любая аутентифицированная. «scope» — действует область видимости 4.3 |
| Объект вне области | `404 NOT_FOUND`; действие запрещено ролью — `403 FORBIDDEN` |

### 8.1.1. Пагинация

Списки: `?page=1&page_size=20` (`page_size` ≤ 100, по умолчанию 20). Ответ:

```json
{
  "items": [ ],
  "page": 1,
  "page_size": 20,
  "total": 134,
  "total_pages": 7
}
```

Пагинация смещением достаточна для MVP (до ~10⁵ записей); курсорная — после пилота.

### 8.1.2. Фильтрация и сортировка

* Фильтры — именованные query-параметры (перечислены у каждого списка); множественные значения — повтор параметра (`status=new&status=accepted`). Неизвестный параметр → `422`.
* Поиск `q` — подстрока без учёта регистра по перечисленным полям.
* Сортировка: `sort=-created_at,priority` (минус — по убыванию). Допустимы только поля из белого списка эндпоинта; иначе `422`. Всегда добавляется детерминирующий вторичный ключ `id`.

### 8.1.3. Формат ошибок

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Заявка была изменена другим пользователем. Обновите данные и повторите действие.",
    "details": { },
    "request_id": "3f6b2d8e-5a41-4a0b-9d4a-1c7e0b9f2a10"
  }
}
```

Сообщения (`message`) — на русском, пригодны для показа пользователю; `code` — стабильный машинный код; `details` — структурированные данные для UI.

### 8.1.4. Каталог кодов ошибок

| HTTP | `code` | Когда |
|---|---|---|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Нет заголовка там, где он обязателен |
| 400 | `MALFORMED_REQUEST` | Невалидный JSON / заголовок |
| 401 | `UNAUTHENTICATED` | Нет/просрочена/отозвана сессия; пользователь деактивирован |
| 401 | `INVALID_CREDENTIALS` | Неверный email/пароль |
| 403 | `FORBIDDEN` | Роль не позволяет действие |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Требуется смена временного пароля |
| 403 | `CSRF_FAILED` | Нет/неверный CSRF-токен |
| 404 | `NOT_FOUND` | Нет объекта или он вне области видимости |
| 409 | `VERSION_CONFLICT` | `version` устарела |
| 409 | `INVALID_TRANSITION` | Действие недопустимо в текущем статусе |
| 409 | `TICKET_LOCKED` | Изменение терминальной заявки / недопустимое поле |
| 409 | `REPORT_LOCKED` | Правка отправленной ревизии отчёта |
| 409 | `ACT_OUTDATED` | Решение по неактуальной версии акта |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Параллельный повтор того же ключа |
| 409 | `DUPLICATE` | Нарушение уникальности (email, инвентарный номер…) |
| 409 | `HAS_ACTIVE_TICKETS`, `HAS_ACTIVE_EQUIPMENT`, `USER_HAS_ACTIVE_ASSIGNMENTS`, `LAST_ADMIN_PROTECTED`, `SELF_DEACTIVATION`, `EQUIPMENT_ARCHIVED`, `ATTACHMENT_LIMIT_EXCEEDED` | Бизнес-ограничения |
| 413 | `FILE_TOO_LARGE` | Размер выше лимита |
| 415 | `UNSUPPORTED_FILE_TYPE` | Тип по содержимому не разрешён |
| 422 | `VALIDATION_ERROR` | Поля не прошли проверку (`details.fields[]`) |
| 422 | `COMPLETION_REQUIREMENTS_NOT_MET` | Не выполнены условия завершения (`details.failed_checks[]`) |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Тот же ключ с другим телом |
| 422 | `ASSIGNEE_NOT_AVAILABLE`, `SAME_ASSIGNEE`, `FILE_CORRUPTED` | Бизнес-проверки |
| 423 | `ACCOUNT_LOCKED` | Вход временно заблокирован |
| 429 | `RATE_LIMITED` | Превышен лимит запросов (Nginx/приложение) |
| 500 | `INTERNAL_ERROR`, `ACT_GENERATION_FAILED`, `FILE_MISSING` | Сбой сервера |
| 503 | `SERVICE_UNAVAILABLE` | БД/хранилище недоступны (`/health/ready`) |

### 8.1.5. Конфликт версий

* Все изменяющие запросы над версионируемыми сущностями содержат `version`.
* Если `version` ≠ текущей: транзакция откатывается, ответ `409 VERSION_CONFLICT`:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Заявка была изменена другим пользователем. Обновите данные и повторите действие.",
    "details": {
      "current_version": 4,
      "sent_version": 3,
      "current_state": {
        "status": "assigned",
        "assigned_engineer": { "id": "6d1c3b7a-0b0e-5c1b-9d66-2b8f1a7e4c11", "full_name": "Инженер Демо-2" },
        "updated_at": "2026-03-16T06:00:00Z"
      }
    },
    "request_id": "3f6b2d8e-5a41-4a0b-9d4a-1c7e0b9f2a10"
  }
}
```

* Клиентское поведение: UI обновляет данные запросом `GET`, показывает баннер с описанием и позволяет повторить действие осознанно; автоматических повторов с новой `version` **нет**.

### 8.1.6. Схема заявки (`Ticket`) — основа ответов

```json
{
  "id": "e1a0c5b4-7d51-5c8e-9a3b-4f7d2c1e8a90",
  "number": "SR-2026-0013",
  "status": "assigned",
  "kind": "corrective",
  "source": "web",
  "priority": "normal",
  "urgency": "planned",
  "title": "Повышенный шум в КТП",
  "description": "При работе слышен периодический гул, температура корпуса выше обычной.",
  "organization": { "id": "…", "name": "ТОО «Демо Металл»" },
  "site": { "id": "…", "name": "Площадка «Металл-Север»" },
  "equipment": { "id": "…", "name": "КТП-2 400 кВА", "inventory_number": "DM-KTP-0002", "type": "substation" },
  "created_by": { "id": "…", "full_name": "Клиент Демо-Металл" },
  "assigned_engineer": { "id": "…", "full_name": "Инженер Демо-2" },
  "contact": { "name": "Клиент Демо-Металл", "phone": "+7 700 000 00 01" },
  "scheduled_at": null,
  "work_stage": null,
  "pause": null,
  "sla": {
    "reaction_limit_seconds": 28800,
    "resolution_limit_seconds": 259200,
    "reaction_due_at": "2026-03-16T13:00:00Z",
    "first_reacted_at": "2026-03-16T05:30:00Z",
    "consumed_seconds": 18000,
    "clock_running": true,
    "due_at": "2026-03-19T05:00:00Z",
    "is_overdue": false
  },
  "current_act": null,
  "return_count": 0,
  "allowed_actions": ["reassign", "cancel", "priority", "edit"],
  "version": 4,
  "created_at": "2026-03-16T05:00:00Z",
  "updated_at": "2026-03-16T06:00:00Z",
  "archived_at": null,
  "warnings": []
}
```

`allowed_actions` вычисляется backend для **текущего пользователя** (UI не дублирует правила переходов); `sla` скрыт у роли `client` частично (без лимитов и `consumed_seconds` — только `is_overdue`).

---

## 8.2. Аутентификация и профиль

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| POST | `/auth/login` | Вход, установка cookie | публично | `{email, password}` | `200 {user, csrf_token, must_change_password}` | 401 `INVALID_CREDENTIALS`, 423 `ACCOUNT_LOCKED`, 429, 422 |
| POST | `/auth/logout` | Выход, отзыв текущей сессии | * | — | `204` | 401 |
| GET | `/auth/me` | Текущий пользователь, роль, организация, `csrf_token`, `permissions[]` | * | — | `200 {user, csrf_token, permissions}` | 401 |
| POST | `/auth/change-password` | Смена пароля, отзыв других сессий | * | `{current_password, new_password}` | `204` | 401, 422 (политика), 403 |
| GET | `/auth/sessions` | Свои активные сессии | * | — | `200 [{id, created_at, last_seen_at, ip, user_agent, is_current}]` | 401 |
| DELETE | `/auth/sessions/{id}` | Отозвать свою сессию | * | — | `204` | 404 |

## 8.3. Пользователи

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/users` | Список пользователей | A, M (все), D (инженеры/клиенты, урезанные поля) | фильтры: `role`, `organization_id`, `is_active`, `q`; `sort` | страница `User` | 403 |
| POST | `/users` | Создать (Idem) | A | `{email, full_name, phone?, role, organization_id, capacity?}` | `201 {user, temp_password}` — пароль **только здесь** | 409 `DUPLICATE`, 422 |
| GET | `/users/{id}` | Карточка | A, M, D(огр.) | — | `User` | 404 |
| PATCH | `/users/{id}` | Изменить ФИО/телефон/роль/организацию/capacity | A | `{…, version}` | `User` | 409, 422 |
| POST | `/users/{id}/reset-password` | Новый временный пароль, отзыв сессий (Idem) | A | `{version}` | `200 {temp_password}` | 404 |
| POST | `/users/{id}/deactivate` | Деактивировать, отозвать сессии | A | `{version}` | `User` | 409 `USER_HAS_ACTIVE_ASSIGNMENTS` / `LAST_ADMIN_PROTECTED` / `SELF_DEACTIVATION` |
| POST | `/users/{id}/activate` | Реактивировать (новый временный пароль) | A | `{version}` | `200 {user, temp_password}` | 404 |
| POST | `/users/{id}/revoke-sessions` | Принудительный выход | A | — | `204` | 404 |
| GET | `/engineers` | Инженеры с загрузкой | A, D, M | `?available=true` | `[{id, full_name, capacity, load, load_pct, active_tickets[]}]` | 403 |

## 8.4. Организации и площадки

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/organizations` | Список (клиент — только своя) | * (scope) | `kind`, `q`, `archived` | страница | — |
| POST | `/organizations` | Создать | A | `{kind:'client', name, short_name?, bin_iin?, contact_*, address?}` | `201 Organization` | 409, 422 |
| GET/PATCH | `/organizations/{id}` | Просмотр/изменение | * (scope) / A | `{…, version}` | `Organization` | 404, 409 |
| POST | `/organizations/{id}/archive` / `/unarchive` | Архивировать | A | `{version}` | `Organization` | 409 `HAS_ACTIVE_TICKETS` |
| GET | `/sites` | Список | * (scope) | `organization_id`, `q`, `archived` | страница | — |
| POST | `/sites` | Создать | A | `{organization_id, name, address, timezone?, contact_*}` | `201 Site` | 409, 422 |
| GET/PATCH | `/sites/{id}` | Просмотр/изменение | * (scope) / A | `{…, version}` | `Site` | 404, 409 |
| POST | `/sites/{id}/archive` / `/unarchive` | Архивировать | A | `{version}` | `Site` | 409 `HAS_ACTIVE_EQUIPMENT` |

## 8.5. Оборудование, паспорт, QR

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/equipment` | Реестр | * (scope) | `organization_id`, `site_id`, `type`, `technical_state`, `has_active_tickets`, `q`, `archived`; `sort` ∈ `name, inventory_number, created_at` | страница `EquipmentBrief` | — |
| POST | `/equipment` | Создать | A, D | поля 6.3 | `201 Equipment` (+`qr_code`) | 409 `DUPLICATE`, 422 |
| GET | `/equipment/{id}` | Паспорт | * (scope) | — | `Equipment` + `next_due_date`, `active_tickets_count`, `repeat_failures_90d` | 404 |
| PATCH | `/equipment/{id}` | Изменить | A, D | `{…, version}` | `Equipment` | 409, 422 |
| POST | `/equipment/{id}/archive` / `/unarchive` | Архивировать | A | `{version}` | `Equipment` | 409 |
| GET | `/equipment/{id}/history` | История обслуживания | * (scope; инженер — урезанные поля) | `page`, `kind`, `status` | страница `{ticket, diagnosis, work_performed, parts[], current_act_id?}` | 404 |
| GET | `/equipment/by-qr/{code}` | Разрешение QR | * (scope) | — | `{equipment_id, redirect: "/equipment/{id}", my_active_ticket_id?}` | 404 |
| GET | `/equipment/{id}/qr` | Изображение QR | * (scope; перевыпуск запрещён клиенту) | `format=svg|png`, `size` | `image/svg+xml` или `image/png` | 404 |
| GET | `/equipment/qr-labels.pdf` | Этикетки для печати | A, D | `ids=…` (≤ 24) | `application/pdf` | 422 |
| POST | `/equipment/{id}/qr/rotate` | Перевыпустить QR | A, D | `{version}` | `Equipment` (новый `qr_code`) | 404, 409 |
| GET | `/equipment/{id}/documents` | Документы паспорта | * (scope) | — | `[Attachment]` | 404 |
| POST | `/equipment/{id}/documents` | Загрузить документ (multipart, Idem) | A, D | `file` (PDF), `title?` | `201 Attachment` | 413, 415, 422 |

## 8.6. Плановое обслуживание

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/maintenance-plans` | Список планов | * (scope) | `equipment_id`, `is_active`, `due_before` | страница | — |
| POST | `/maintenance-plans` | Создать | A, D | поля 6.12 | `201 Plan` | 422 |
| GET/PATCH | `/maintenance-plans/{id}` | Просмотр/изменение | * (scope) / A, D | `{…, version}` | `Plan` | 404, 409 |
| POST | `/maintenance-plans/{id}/deactivate` / `/activate` | Включить/выключить | A, D | `{version}` | `Plan` | 409 |
| GET | `/maintenance/upcoming` | Ближайшие плановые даты | * (scope) | `days` (1–90, по умолчанию 14) | `[{plan, equipment, next_due_date, overdue}]` | — |

## 8.7. Заявки

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/tickets` | Список | * (scope) | `status[]`, `priority[]`, `kind`, `organization_id`, `site_id`, `equipment_id`, `assigned_engineer_id`, `overdue`, `created_from`, `created_to`, `q`, `archived`; `sort` ∈ `created_at, priority, sla_due_at, status, number` | страница `Ticket` | 422 |
| POST | `/tickets` | Создать (Idem) | C, D | `{equipment_id, title, description, urgency?, contact_name?, contact_phone?, related_ticket_id?}` | `201 Ticket` (+`warnings`) | 404, 409 `EQUIPMENT_ARCHIVED`, 422 |
| GET | `/tickets/{id}` | Карточка | * (scope) | — | `Ticket` | 404 |
| PATCH | `/tickets/{id}` | Изменить поля (T15) | C(создатель, `new`), D | `{title?, description?, contact_*?, scheduled_at?, version}` | `Ticket` | 409 `TICKET_LOCKED`/`VERSION_CONFLICT`, 422 |
| GET | `/tickets/{id}/events` | Таймлайн | * (scope; клиент — только public) | `page` | страница событий | 404 |
| GET | `/me/tasks` | Задания инженера | E | `group=today|upcoming|paused|awaiting|done` | сгруппированный список `Ticket` | 403 |
| GET | `/search` | Поиск по оборудованию и заявкам | * (scope) | `q` (≥ 2 символа), `limit` ≤ 20 | `{equipment:[…], tickets:[…]}` | 422 |
| GET | `/tickets/export.csv` (SHOULD) | Экспорт списка по фильтрам | A, D, M | как `/tickets` | CSV | — |

## 8.8. Переходы статусов

Все — `POST`, тело содержит `version`, заголовок `Idempotency-Key` обязателен (кроме `priority` и `reassign`, где он рекомендован). Ответ — обновлённый `Ticket`. Ошибки для всех: 404, 403, 409 `VERSION_CONFLICT`/`INVALID_TRANSITION`, 422. Подробности — таблица 5.3.

| Путь | Из → В | Роли | Тело запроса (кроме `version`) | Дополнительные ошибки |
|---|---|---|---|---|
| `/tickets/{id}/accept` | `new → accepted` | D | `priority` | — |
| `/tickets/{id}/reject` | `new → rejected` | D | `reason_code`, `comment`, `duplicate_of_ticket_id?` | — |
| `/tickets/{id}/assign` | `accepted → assigned`, `new → assigned` | D | `engineer_id`, `priority?` (обязателен из `new`), `scheduled_at?`, `comment?` | 422 `ASSIGNEE_NOT_AVAILABLE` |
| `/tickets/{id}/reassign` | `assigned/in_progress/paused` | D | `engineer_id`, `reason` | 422 `SAME_ASSIGNEE` |
| `/tickets/{id}/start` | `assigned → in_progress` | E | — | — |
| `/tickets/{id}/pause` | `in_progress → paused` | E, D | `reason_code`, `comment`, `next_action`, `expected_resume_at` | — |
| `/tickets/{id}/resume` | `paused → in_progress` | E, D | `comment?` | — |
| `/tickets/{id}/complete` | `in_progress → awaiting_confirmation` | E | — | 422 `COMPLETION_REQUIREMENTS_NOT_MET`, 500 `ACT_GENERATION_FAILED` |
| `/tickets/{id}/confirm` | `awaiting_confirmation → closed` | C | `act_id`, `rating?`, `comment?` | 409 `ACT_OUTDATED` |
| `/tickets/{id}/return` | `awaiting_confirmation → in_progress` | C | `act_id`, `comment` (≥ 10) | 409 `ACT_OUTDATED` |
| `/tickets/{id}/cancel` | см. T12/T13 | C, D | `reason` | 409 `INVALID_TRANSITION` |
| `/tickets/{id}/priority` | активные статусы | D | `priority`, `reason` | — |
| `/tickets/{id}/archive` / `/unarchive` | терминальные | A | — | 409 |

## 8.9. Назначения

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/tickets/{id}/assignments` | История назначений | A, D, M, E(своя заявка) | — | `[{engineer, assigned_by, assigned_at, scheduled_at, ended_at, end_reason, comment}]` | 404 |
| GET | `/engineers/{id}/workload` | Загрузка и активные заявки | A, D, M, E(self) | — | `{capacity, load, load_pct, tickets[]}` | 404 |

## 8.10. Диагностика, отчёт, чек-листы

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/tickets/{id}/report` | Текущая ревизия отчёта (черновик или последняя отправленная) + `completion_check` | E(asg), D, M, A | `?revision=` | `WorkReport` | 404 |
| PUT | `/tickets/{id}/report` | Автосохранение черновика | E(asg) | `{diagnosis?, work_performed?, result_code?, result_summary?, recommendations?, labor_minutes?, checklist_answers?, parts_confirmed?, version}` | `WorkReport` | 409 `VERSION_CONFLICT`/`REPORT_LOCKED`, 422 |
| GET | `/tickets/{id}/report/completion-check` | Предпроверка условий C1–C5 без действия | E(asg) | — | `{ok, failed_checks[]}` | 404 |
| POST | `/tickets/{id}/photo-exception` | Запросить исключение (Idem) | E(asg) | `{reason (≥20), version}` | `WorkReport` | 409, 422 |
| POST | `/tickets/{id}/photo-exception/decision` | Решение | D | `{decision:'approved'|'rejected', comment?, version}` | `WorkReport` | 409 |
| GET | `/checklist-templates` | Шаблоны | A, D, M, E | `equipment_type`, `status`, `code` | страница | — |
| GET | `/checklist-templates/{id}` | Шаблон | A, D, M, E | — | `ChecklistTemplate` | 404 |
| POST | `/checklist-templates` | Создать черновик | A | `{code, equipment_type, title, schema}` | `201` | 422 |
| PATCH | `/checklist-templates/{id}` | Изменить **черновик** | A | `{…}` | `ChecklistTemplate` | 409 (не `draft`) |
| POST | `/checklist-templates/{id}/publish` | Опубликовать (прежняя активная → `retired`) | A | — | `ChecklistTemplate` | 409, 422 |
| POST | `/checklist-templates/{id}/new-version` | Новый черновик на основе версии | A | — | `201` | — |

## 8.11. Запчасти

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/spare-parts` | Справочник | A, D, M, E | `q`, `category`, `is_active` | страница | — |
| POST | `/spare-parts` | Создать | A, D | `{sku, name, unit, category?, description?}` | `201` | 409 `DUPLICATE` |
| PATCH | `/spare-parts/{id}` | Изменить/деактивировать | A, D | `{…, version}` | `SparePart` | 409 |
| GET | `/tickets/{id}/parts` | Использованное | A, D, M, E(asg), C(в рамках акта) | — | `[PartUsage]` | 404 |
| POST | `/tickets/{id}/parts` | Добавить позицию | E(asg) | `{spare_part_id, quantity, serial_or_batch?, comment?}` | `201 PartUsage` | 409 `REPORT_LOCKED`/`DUPLICATE`, 422 |
| PATCH | `/tickets/{id}/parts/{usage_id}` | Изменить | E(asg) | `{quantity?, serial_or_batch?, comment?}` | `PartUsage` | 409 |
| DELETE | `/tickets/{id}/parts/{usage_id}` | Удалить (только черновик) | E(asg) | — | `204` | 409 |

## 8.12. Файлы

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| POST | `/tickets/{id}/attachments` | Загрузить (multipart, Idem) | C(own), D, E(asg) | `file`, `kind` (`photo`/`document`), `stage?` (для фото), `visibility?` | `201 Attachment` | 413, 415, 422 `FILE_CORRUPTED`, 409 `ATTACHMENT_LIMIT_EXCEEDED`/`TICKET_LOCKED` |
| GET | `/tickets/{id}/attachments` | Список | * (scope; клиент — public) | `kind`, `stage` | `[Attachment]` | 404 |
| GET | `/attachments/{id}/download` | Скачать файл | * (scope) | `?inline=1` | бинарный поток | 404 |
| GET | `/attachments/{id}/thumbnail` | Миниатюра | * (scope) | — | `image/jpeg` | 404 |
| DELETE | `/attachments/{id}` | Мягко удалить | автор, D | — | `204` | 409 (отчёт отправлен / заявка терминальна) |

`Attachment`: `{id, kind, stage, visibility, original_filename, content_type, size_bytes, width, height, uploaded_by, uploaded_at, urls: {download, thumbnail}}`. URL — относительные пути API, без подписанных ссылок.

## 8.13. Акты

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/tickets/{id}/acts` | Все версии актов | * (scope) | — | `[{id, version, number, is_current, generated_at, decision, decided_at, size_bytes}]` | 404 |
| GET | `/acts/{id}` | Метаданные акта | * (scope) | — | `Act` | 404 |
| GET | `/acts/{id}/pdf` | PDF | * (scope) | `?download=1` | `application/pdf` | 404, 500 `FILE_MISSING` |
| GET | `/acts/{id}/confirmation.pdf` (SHOULD) | Лист подтверждения | * (scope), если `decision='confirmed'` | — | `application/pdf` | 404 |

Генерация — внутри `POST /tickets/{id}/complete`; подтверждение и возврат — `confirm` / `return` (8.8).

## 8.14. Комментарии

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/tickets/{id}/comments` | Список | * (scope; клиент — public) | `page` | страница | 404 |
| POST | `/tickets/{id}/comments` | Добавить (Idem) | * (scope; internal — не C) | `{body, visibility?}` | `201 Comment` | 403 (клиент + internal), 422 |

## 8.15. Уведомления

| Метод | Путь | Назначение | Роли | Запрос | Ответ | Ошибки |
|---|---|---|---|---|---|---|
| GET | `/notifications` | Свои уведомления | * | `unread=true`, `page` | страница | — |
| GET | `/notifications/unread-count` | Счётчик | * | — | `{count}` | — |
| POST | `/notifications/{id}/read` | Прочитано | * | — | `204` | 404 |
| POST | `/notifications/read-all` | Прочитать все | * | — | `204` | — |

## 8.16. Аналитика

Параметры общие: `from`, `to` (по `created_at` заявки; по умолчанию последние 30 дней от «сейчас» `Clock`), `organization_id?`, `site_id?`, `equipment_type?`. Для клиента `organization_id` принудительно равен его организации. Определения — раздел 10.

| Метод | Путь | Назначение | Роли | Ответ |
|---|---|---|---|---|
| GET | `/analytics/summary` | Все KPI одним запросом | A, D, M, C(own, урезано), E(self) | см. пример ниже |
| GET | `/analytics/tickets-by-status` | Счётчики по статусам и приоритетам | A, D, M, C(own) | `{by_status:{…}, by_priority_active:{…}}` |
| GET | `/analytics/overdue` | Список просроченных | A, D, M, C(own), E(self) | страница `Ticket` + `overdue_kind` (`resolution`/`reaction`) |
| GET | `/analytics/sla` | Реакция, время до завершения, доля в срок | A, D, M, C(own) | `{avg_reaction_seconds, reaction_sample, avg_completion_seconds, completion_sample, on_time_pct, on_time_count, on_time_sample}` |
| GET | `/analytics/engineer-load` | Загрузка инженеров | A, D, M, E(self) | `[{engineer, capacity, load, load_pct}]` |
| GET | `/analytics/repeat-failures` | Повторные неисправности | A, D, M, C(own) | `{window_days, repeat_count, corrective_total, repeat_pct, items[]}` |
| GET | `/analytics/metric-tickets` | Расшифровка метрики списком | как метрика | `?metric=active|overdue|reaction|completion|on_time|repeat` → страница `Ticket` |

## 8.17. Справочники и настройки

| Метод | Путь | Назначение | Роли | Запрос | Ответ |
|---|---|---|---|---|---|
| GET | `/settings/sla` | Политика SLA | A, D, M | — | `[{priority, reaction_minutes, resolution_minutes, version}]` |
| PUT | `/settings/sla` | Изменить политику (аудит) | A | `{items:[…], version}` | то же |
| GET | `/audit-log` | Журнал аудита | A | `action`, `actor_user_id`, `from`, `to`, `page` | страница |

## 8.18. Healthcheck

| Метод | Путь | Назначение | Роли | Ответ |
|---|---|---|---|---|
| GET | `/health/live` | Процесс жив (без обращений к БД) | публично | `200 {"status":"ok"}` |
| GET | `/health/ready` | Готовность: подключение к БД, `alembic_version` = head, каталог файлов доступен для записи | публично, минимальные детали | `200 {"status":"ok","version":"…"}` или `503 {"status":"unavailable","checks":{"db":"fail"}}` |

Используется Docker `healthcheck` (раздел 11) и мониторингом; чувствительных деталей не содержит.

---

## 8.19. Примеры

### 8.19.1. Создание заявки

`POST /api/v1/tickets` · `Idempotency-Key: 0f5b3a1e-6a27-4a63-b3f4-8e6c2b0d7a11` · `X-CSRF-Token: …` · роль `client`

```json
{
  "equipment_id": "b2d6a1c0-3c7e-5f21-8a44-0d9e6f1b7c23",
  "title": "Повышенный шум и нагрев КТП",
  "description": "С утра слышен гул при нагрузке, корпус горячее обычного. Запаха гари нет.",
  "urgency": "urgent",
  "contact_name": "Клиент Демо-Металл",
  "contact_phone": "+7 700 000 00 01"
}
```

Ответ `201 Created`:

```json
{
  "id": "e1a0c5b4-7d51-5c8e-9a3b-4f7d2c1e8a90",
  "number": "SR-2026-0021",
  "status": "new",
  "priority": "high",
  "urgency": "urgent",
  "kind": "corrective",
  "source": "web",
  "title": "Повышенный шум и нагрев КТП",
  "sla": { "is_overdue": false },
  "allowed_actions": ["edit", "cancel"],
  "version": 1,
  "created_at": "2026-03-17T05:12:00Z",
  "warnings": [
    {
      "code": "ACTIVE_TICKET_EXISTS",
      "message": "По этому оборудованию уже есть активная заявка SR-2026-0013.",
      "details": { "ticket_id": "…", "number": "SR-2026-0013" }
    }
  ]
}
```

Повтор с тем же `Idempotency-Key` и тем же телом возвращает **тот же** ответ с заголовком `Idempotent-Replay: true`.

### 8.19.2. Назначение инженера

`POST /api/v1/tickets/e1a0c5b4-…/assign` · `Idempotency-Key: …` · роль `dispatcher`

```json
{
  "version": 2,
  "engineer_id": "6d1c3b7a-0b0e-5c1b-9d66-2b8f1a7e4c11",
  "scheduled_at": "2026-03-17T08:00:00Z",
  "comment": "Подготовить тепловизор."
}
```

Ответ `200 OK`: `Ticket` со `status: "assigned"`, `assigned_engineer`, `version: 3`, `warnings: [{"code":"ENGINEER_OVERLOADED", …}]` (если загрузка ≥ 100%).

### 8.19.3. Приостановка работ

`POST /api/v1/tickets/{id}/pause` · роль `engineer`

```json
{
  "version": 7,
  "reason_code": "waiting_parts",
  "comment": "Требуется замена предохранителей ПКТ-10, на объекте нужных нет.",
  "next_action": "Диспетчер заказывает предохранители и подтверждает срок поставки.",
  "expected_resume_at": "2026-03-19T04:00:00Z"
}
```

Ответ `200 OK`: `status: "paused"`, `pause: {reason_code, comment, next_action, expected_resume_at}`, `sla.clock_running: false`, `version: 8`.

### 8.19.4. Завершение работ

`POST /api/v1/tickets/{id}/complete` · `Idempotency-Key: …` · роль `engineer`

```json
{ "version": 9 }
```

Успех `200 OK`:

```json
{
  "id": "…",
  "number": "SR-2026-0006",
  "status": "awaiting_confirmation",
  "sla": { "clock_running": false, "is_overdue": false },
  "current_act": {
    "id": "a7c3e0f2-9b14-5d68-8f01-3e2d7b6a4c55",
    "version": 1,
    "number": "SR-2026-0006-A1",
    "is_current": true,
    "generated_at": "2026-03-16T03:00:00Z"
  },
  "allowed_actions": [],
  "version": 10
}
```

Отказ `422 Unprocessable Entity`:

```json
{
  "error": {
    "code": "COMPLETION_REQUIREMENTS_NOT_MET",
    "message": "Нельзя завершить заявку: не выполнены обязательные условия.",
    "details": {
      "failed_checks": [
        { "code": "CHECKLIST_INCOMPLETE", "message": "Не заполнены пункты чек-листа.", "keys": ["insulation_mohm", "grounding_ok"] },
        { "code": "PHOTOS_MISSING", "message": "Добавьте фото «до» и «после» или запросите исключение у диспетчера." }
      ]
    },
    "request_id": "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e"
  }
}
```

### 8.19.5. Подтверждение клиентом

`POST /api/v1/tickets/{id}/confirm` · `Idempotency-Key: …` · роль `client`

```json
{
  "version": 10,
  "act_id": "a7c3e0f2-9b14-5d68-8f01-3e2d7b6a4c55",
  "rating": 5,
  "comment": "Работы приняты, замечаний нет."
}
```

Ответ `200 OK`: `status: "closed"`, `closed_at`, `current_act.decision: "confirmed"`, `version: 11`.

Подтверждение устаревшего акта → `409`:

```json
{
  "error": {
    "code": "ACT_OUTDATED",
    "message": "Этот акт больше не актуален: заявка была возвращена и по ней сформирована новая версия.",
    "details": { "sent_act_id": "…", "current_act_id": "…", "current_version": 2 },
    "request_id": "…"
  }
}
```

### 8.19.6. Ошибка валидации

`422` при создании заявки с пустым описанием:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Проверьте заполнение полей.",
    "details": {
      "fields": [
        { "field": "description", "code": "too_short", "message": "Описание должно содержать не менее 10 символов." },
        { "field": "equipment_id", "code": "required", "message": "Выберите оборудование." }
      ]
    },
    "request_id": "…"
  }
}
```

### 8.19.7. `GET /analytics/summary`

```json
{
  "period": { "from": "2026-02-14T10:00:00Z", "to": "2026-03-16T10:00:00Z", "generated_at": "2026-03-16T10:00:00Z" },
  "tickets_total": 20,
  "by_status": { "new": 2, "accepted": 1, "assigned": 2, "in_progress": 3, "paused": 2, "awaiting_confirmation": 2, "closed": 5, "rejected": 1, "cancelled": 2 },
  "active": { "count": 12, "by_priority": { "critical": 2, "high": 4, "normal": 5, "low": 1 } },
  "overdue": { "count": 2, "resolution": 1, "reaction": 1 },
  "reaction": { "avg_seconds": 2300, "sample": 15 },
  "completion": { "avg_seconds": 116743, "sample": 7 },
  "on_time": { "count": 6, "sample": 7, "pct": 85.7 },
  "engineer_load": [
    { "engineer_id": "…", "full_name": "Инженер Демо-1", "capacity": 4, "load": 3, "load_pct": 75.0 },
    { "engineer_id": "…", "full_name": "Инженер Демо-2", "capacity": 4, "load": 4, "load_pct": 100.0 }
  ],
  "repeat_failures": { "window_days": 30, "count": 2, "corrective_total": 15, "pct": 13.3 }
}
```

(значения соответствуют demo при `T0`, раздел 12.6).

## 8.20. Критерии приёмки раздела

| № | Критерий | Тест |
|---|---|---|
| 8-1 | OpenAPI-схема содержит все эндпоинты 8.2–8.18; контрактный тест сравнивает ответы с Pydantic-схемами | IT-35 |
| 8-2 | Для каждого эндпоинта есть тест «без сессии → 401», «чужая роль → 403/404» | IT-01, IT-03, IT-04 |
| 8-3 | Все ошибки приходят в формате 8.1.3 с `request_id` | IT-14 |
| 8-4 | Эндпоинты с «Idem» без заголовка отвечают `400` | IT-13 |
| 8-5 | Списки поддерживают пагинацию/сортировку/фильтры и отвергают неизвестные параметры | IT-36 |
