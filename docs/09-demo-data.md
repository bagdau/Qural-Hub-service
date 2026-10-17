# Раздел 12. Тестовые (demo) данные

Все данные — **синтетические**: вымышленные организации с пометкой «Демо», адреса и телефоны условные, e-mail в зарезервированной зоне `.test`, реальных персональных данных нет. Названия организаций не относятся к реальным компаниям и не означают участия Alageum Group.

## 12.1. Принципы seed

| Принцип | Требование |
|---|---|
| Воспроизводимость | Все идентификаторы детерминированы: `uuid5(NAMESPACE_DEMO, "<тип>:<ключ>")`, где `NAMESPACE_DEMO = a1a9e000-0000-5000-8000-000000000001` (ДП). Все моменты времени заданы абсолютно (UTC) и не зависят от запуска |
| Атомарность | Загрузка выполняется **одной транзакцией**: либо загружено всё, либо ничего. Файлы пишутся до коммита и удаляются при откате |
| Без дублей | Справочные сущности вставляются через upsert по естественным ключам (email, имя организации, `(organization, inventory_number)`, `sku`, `(code, version)`, номер заявки). Журнальные таблицы (`ticket_events`, `assignments`, `work_reports`, `acts` …) не имеют естественных ключей, поэтому защита — маркер `app_meta.demo_seed_version`: если маркер равен текущей версии seed, команда завершается кодом 0 с сообщением «demo уже загружено», ничего не меняя. Повторный запуск = no-op |
| Сброс | `python -m app.cli reset-demo --yes` (только `dev/test/demo`) удаляет **только** строки с идентификаторами из `NAMESPACE_DEMO` и очищает маркер; затем `seed-demo` загружает заново |
| Пароли | Единый demo-пароль берётся из окружения (`DEMO_USER_PASSWORD_FILE`/`DEMO_USER_PASSWORD`), ≥ 12 символов, в репозитории отсутствует; хэшируется Argon2id при загрузке. `must_change_password = false` только для demo-пользователей |
| Запрет в пилоте | (1) `APP_ENV ∈ {dev, test, demo}`, иначе код выхода 2; (2) `ALLOW_DEMO_SEED=true`; (3) `app_meta.deployment_mode ≠ 'pilot'`; (4) пароль задан. Команда установки пилота `python -m app.cli init-pilot` записывает `deployment_mode='pilot'` и отказывается работать, если в БД есть маркер demo |
| Файлы | Фото — генерируемые заглушки (изображение 800×600 с надписью «DEMO», детерминированный байтовый результат), PDF актов формируются реальным генератором из `data_snapshot`; настоящих фотографий нет |
| Часы | В `demo/test` используется `APP_CLOCK_MODE=fixed` (`APP_FIXED_NOW=T0`) для проверки значений; для презентации — `shifted` (время течёт, начиная с `T0`) |
| Расположение | `backend/seed/demo/*.json` + `backend/seed/loader.py`; JSON — исходник правды, таблицы ниже — их человекочитаемая форма |

## 12.2. Demo-время

**`T0 = 2026-03-16T10:00:00Z`** (понедельник; 15:00 по Алматы, UTC+5 — ДП). Все «срезовые» метрики дашборда рассчитаны на `T0`. Режимы `Clock`:

| Режим | Поведение | Применение |
|---|---|---|
| `system` | Реальное время | pilot |
| `fixed` | Всегда `APP_FIXED_NOW` | тесты, проверка ожидаемых значений |
| `shifted` | `APP_FIXED_NOW + (реальное время − момент старта процесса)` | презентации demo |

Для проверки уведомлений и плановых заявок тест переводит `fixed`-часы на нужный момент (`POST /api/v1/_test/clock` — **только `APP_ENV=test`**, в остальных режимах маршрута нет).

## 12.3. Организации, площадки, пользователи

### Организации (4)

| Ключ | Вид | Название | Примечание |
|---|---|---|---|
| `ORG-SVC` | `service` | ТОО «Демо-Сервис Энерго» | Единственная сервисная организация |
| `ORG-C1` | `client` | ТОО «Демо Металл» | 2 площадки, 4 единицы оборудования |
| `ORG-C2` | `client` | ТОО «Демо Агро» | 2 площадки, 3 единицы |
| `ORG-C3` | `client` | ТОО «Демо Логистик» | 1 площадка, 3 единицы |

### Пользователи (8)

Пароль у всех — значение `DEMO_USER_PASSWORD` (в таблице не приводится).

| Ключ | Email | ФИО | Роль | Организация | Телефон | Прочее |
|---|---|---|---|---|---|---|
| `U-ADM` | admin@demo.alageum.test | Админ Демо | `admin` | ORG-SVC | +7 700 000 00 10 | |
| `U-DSP` | dispatcher@demo.alageum.test | Диспетчер Демо | `dispatcher` | ORG-SVC | +7 700 000 00 11 | |
| `U-MGR` | manager@demo.alageum.test | Руководитель Демо | `manager` | ORG-SVC | +7 700 000 00 12 | |
| `U-ENG1` | engineer1@demo.alageum.test | Инженер Демо-1 | `engineer` | ORG-SVC | +7 700 000 00 13 | `capacity = 4` |
| `U-ENG2` | engineer2@demo.alageum.test | Инженер Демо-2 | `engineer` | ORG-SVC | +7 700 000 00 14 | `capacity = 4` |
| `U-CL1` | client.metal@demo.alageum.test | Клиент Демо-Металл | `client` | ORG-C1 | +7 700 000 00 01 | |
| `U-CL2` | client.agro@demo.alageum.test | Клиент Демо-Агро | `client` | ORG-C2 | +7 700 000 00 02 | |
| `U-CL3` | client.logistics@demo.alageum.test | Клиент Демо-Логистик | `client` | ORG-C3 | +7 700 000 00 03 | |

### Площадки (5)

| Ключ | Организация | Название | Адрес (условный) |
|---|---|---|---|
| `S1` | ORG-C1 | Площадка «Металл-Север» | г. Шымкент, ул. Условная, 1 |
| `S2` | ORG-C1 | Площадка «Металл-Юг» | г. Шымкент, ул. Условная, 25 |
| `S3` | ORG-C2 | Ферма «Агро-1» | Демо-район, участок 3 |
| `S4` | ORG-C2 | Элеватор «Агро-2» | Демо-район, участок 7 |
| `S5` | ORG-C3 | Склад «Логистик-Центр» | г. Шымкент, пр. Тестовый, 10 |

## 12.4. Оборудование, запчасти, шаблоны, планы

### Оборудование (10)

| Ключ | Орг. | Площадка | Тип | Инв. № | Название | Мощн. кВА | Класс кВ | Состояние | `qr_code` |
|---|---|---|---|---|---|---|---|---|---|
| `EQ-01` | C1 | S1 | transformer | DM-TR-0001 | Трансформатор ТМ-1000/10 | 1000 | 10 | operational | DEMOEQUIP001 |
| `EQ-02` | C1 | S1 | substation | DM-KTP-0002 | КТП-2 400 кВА | 400 | 10 | degraded | DEMOEQUIP002 |
| `EQ-03` | C1 | S2 | switchgear | DM-RU-0003 | РУ-6 кВ, 12 ячеек | — | 6 | operational | DEMOEQUIP003 |
| `EQ-04` | C1 | S2 | transformer | DM-TR-0004 | Трансформатор ТМ-630/10 | 630 | 10 | operational | DEMOEQUIP004 |
| `EQ-05` | C2 | S3 | transformer | DA-TR-0001 | Трансформатор ТМ-400/10 | 400 | 10 | operational | DEMOEQUIP005 |
| `EQ-06` | C2 | S3 | substation | DA-KTP-0002 | КТП-250 | 250 | 10 | operational | DEMOEQUIP006 |
| `EQ-07` | C2 | S4 | switchgear | DA-RU-0003 | РУ-0,4 кВ элеватора | — | 0.4 | out_of_service | DEMOEQUIP007 |
| `EQ-08` | C3 | S5 | transformer | DL-TR-0001 | Трансформатор ТМ-250/10 | 250 | 10 | degraded | DEMOEQUIP008 |
| `EQ-09` | C3 | S5 | substation | DL-KTP-0002 | КТП-160 | 160 | 10 | operational | DEMOEQUIP009 |
| `EQ-10` | C3 | S5 | switchgear | DL-RU-0003 | РУ-10 кВ, 8 ячеек | — | 10 | operational | DEMOEQUIP010 |

Производитель — «Демо-Электро» (вымышленный), серийные номера `DEMO-SN-0001 … 0010`, годы выпуска 2008–2021. QR-код для tests и demo фиксирован (12 символов, `^[A-Z0-9]{12}$`); в pilot — случайный. Документ к паспорту: `EQ-01` — «Паспорт изделия (демо).pdf» (генерируемая заглушка).

### Запчасти (6)

| Ключ | SKU | Название | Ед. |
|---|---|---|---|
| `SP-01` | SP-OIL-01 | Масло трансформаторное | `l` |
| `SP-02` | SP-SIL-01 | Силикагель-осушитель | `kg` |
| `SP-03` | SP-FUS-10 | Предохранитель ПКТ-10 | `pcs` |
| `SP-04` | SP-INS-01 | Изолятор опорный | `pcs` |
| `SP-05` | SP-CNT-01 | Контактор трёхполюсный | `pcs` |
| `SP-06` | SP-GSK-01 | Прокладка уплотнительная (комплект) | `set` |

### Шаблоны чек-листов

| Ключ | `code` | Версия | Тип оборудования | Статус | Публикация |
|---|---|---|---|---|---|
| `CT-TR-1` | `transformer_inspection` | 1 | transformer | `retired` | 2026-01-10T00:00Z, выведен 2026-03-05T00:00Z |
| `CT-TR-2` | `transformer_inspection` | 2 | transformer | `active` | 2026-03-05T00:00Z |
| `CT-SS-1` | `substation_inspection` | 1 | substation | `active` | 2026-01-10T00:00Z |
| `CT-SW-1` | `switchgear_inspection` | 1 | switchgear | `active` | 2026-01-10T00:00Z |

Пример `CT-TR-2` (JSON):

```json
{
  "code": "transformer_inspection",
  "version": 2,
  "equipment_type": "transformer",
  "title": "Осмотр силового трансформатора",
  "status": "active",
  "published_at": "2026-03-05T00:00:00Z",
  "schema": {
    "items": [
      { "key": "oil_leak", "section": "Визуальный осмотр", "label": "Течь масла отсутствует", "type": "boolean", "required": true, "flag_if": { "equals": false } },
      { "key": "oil_level", "section": "Визуальный осмотр", "label": "Уровень масла по указателю", "type": "enum", "required": true,
        "options": [ { "value": "low", "label": "Ниже нормы", "flag": true }, { "value": "normal", "label": "Норма" }, { "value": "high", "label": "Выше нормы", "flag": true } ] },
      { "key": "bushings_ok", "section": "Визуальный осмотр", "label": "Вводы без трещин и загрязнений", "type": "boolean", "required": true, "flag_if": { "equals": false } },
      { "key": "oil_temp_c", "section": "Измерения", "label": "Температура верхних слоёв масла", "type": "number", "unit": "°C", "min": -50, "max": 150, "required": true, "flag_if": { "gt": 85 } },
      { "key": "load_current_a", "section": "Измерения", "label": "Ток нагрузки", "type": "number", "unit": "А", "min": 0, "max": 5000, "required": false },
      { "key": "insulation_mohm", "section": "Измерения", "label": "Сопротивление изоляции", "type": "number", "unit": "МОм", "min": 0, "max": 100000, "required": true, "flag_if": { "lt": 100 } },
      { "key": "grounding_ok", "section": "Безопасность", "label": "Заземление в порядке", "type": "boolean", "required": true, "flag_if": { "equals": false } },
      { "key": "notes", "section": "Прочее", "label": "Замечания", "type": "text", "required": false }
    ]
  }
}
```

`CT-SS-1` (КТП) — пункты: `enclosure_ok`, `ventilation_ok`, `breaker_state` (enum), `fuses_ok`, `contacts_heating_ok`, `insulation_mohm`, `grounding_ok`, `notes`. `CT-SW-1` (РУ) — пункты: `cells_clean_ok`, `breaker_operation_ok` (пробное включение/отключение), `interlocks_ok`, `relay_protection_ok`, `contacts_heating_ok`, `insulation_mohm`, `grounding_ok`, `notes`. Полные схемы — в `checklist_templates.json`.

### Планы обслуживания (3)

| Ключ | Оборудование | Название | Интервал, дн. | `lead_days` | Приоритет | `last_done_on` | `next_due_date` | Состояние на `T0` |
|---|---|---|---|---|---|---|---|---|
| `MP-01` | EQ-02 | ТО-1 КТП | 90 | 7 | low | 2026-03-11 | 2026-06-09 | Заявка SR-2026-0005 (срок 2026-03-17) закрыта 03-11, дата сдвинута |
| `MP-02` | EQ-04 | Профилактический осмотр трансформатора | 180 | 7 | low | 2025-09-22 | 2026-03-21 | Заявка SR-2026-0014 создана 03-14 (срок 03-21) |
| `MP-03` | EQ-10 | Осмотр РУ-10 кВ | 90 | 7 | low | 2025-12-24 | 2026-03-24 | Заявка **будет создана** задачей worker 2026-03-17T05:00Z |

## 12.5. Заявки (20)

Приоритеты и сроки — раздел 10.1. «Реакция» — минуты от создания до `accepted`. «Расход» — `consumed` на момент завершения (для завершённых) или на `T0` (для активных), часы.

### 12.5.1. Список

| № | Номер | Орг. | Оборуд. | Вид / источник | Приоритет | Срочность | Статус на `T0` | Название |
|---|---|---|---|---|---|---|---|---|
| 1 | SR-2026-0001 | C1 | EQ-01 | corrective / web | normal | planned | closed | Течь масла на трансформаторе |
| 2 | SR-2026-0002 | C1 | EQ-03 | corrective / web | high | urgent | closed | Перегрев ячейки РУ-6 кВ |
| 3 | SR-2026-0003 | C2 | EQ-05 | corrective / web | critical | emergency | closed | Аварийное отключение трансформатора |
| 4 | SR-2026-0004 | C3 | EQ-08 | corrective / web | normal | planned | closed | Повышенный уровень шума трансформатора |
| 5 | SR-2026-0005 | C1 | EQ-02 | planned / scheduler (MP-01, срок 2026-03-17) | low | planned | closed | Плановое ТО-1 КТП-2 |
| 6 | SR-2026-0006 | C1 | EQ-04 | corrective / web | high | urgent | awaiting_confirmation | Нагрев вводов трансформатора |
| 7 | SR-2026-0007 | C2 | EQ-06 | corrective / web | normal | planned | awaiting_confirmation | Срабатывание защиты КТП |
| 8 | SR-2026-0008 | C2 | EQ-07 | corrective / web | critical | emergency | in_progress | Отказ вводного автомата РУ-0,4 кВ |
| 9 | SR-2026-0009 | C3 | EQ-09 | corrective / web | high | urgent | in_progress | Искрение на шинах КТП |
| 10 | SR-2026-0010 | C3 | EQ-10 | corrective / web | normal | planned | in_progress | Не включается секционный выключатель РУ-10 кВ |
| 11 | SR-2026-0011 | C1 | EQ-01 | corrective / web | normal | planned | paused | Повторная течь масла |
| 12 | SR-2026-0012 | C3 | EQ-08 | corrective / web | high | urgent | paused | Перегорание предохранителей ПКТ-10 |
| 13 | SR-2026-0013 | C1 | EQ-02 | corrective / web | normal | planned | assigned | Повышенный шум в КТП |
| 14 | SR-2026-0014 | C1 | EQ-04 | planned / scheduler (MP-02, срок 2026-03-21) | low | planned | assigned | Плановый профилактический осмотр трансформатора |
| 15 | SR-2026-0015 | C2 | EQ-06 | corrective / web | high | urgent | accepted | Запах гари у шкафа КТП |
| 16 | SR-2026-0016 | C3 | EQ-10 | corrective / web | normal | planned | new | Показания приборов РУ-10 кВ нестабильны |
| 17 | SR-2026-0017 | C3 | EQ-09 | corrective / web | critical | emergency | new | Отключение вводного шкафа КТП-160 |
| 18 | SR-2026-0018 | C2 | EQ-06 | corrective / web | normal | planned | rejected | Срабатывание защиты КТП (повторное обращение) |
| 19 | SR-2026-0019 | C1 | EQ-03 | corrective / web | normal | planned | cancelled | Мигает индикация РУ-6 кВ |
| 20 | SR-2026-0020 | C3 | EQ-09 | corrective / web | normal | planned | cancelled | Осмотр КТП-160 по графику клиента |

Создатели: заявки C1 — `U-CL1`, C2 — `U-CL2`, C3 — `U-CL3`; плановые SR-0005 и SR-0014 — система (`created_by = NULL`). Все действия диспетчера — `U-DSP`.

### 12.5.2. История переходов (все моменты — UTC, 2026-03-xx)

Условные обозначения: `acc` — accepted, `asg` — assigned (инженер), `start` — in_progress, `pause`/`res` — paused/resumed, `done` — complete (в `awaiting_confirmation`, акт), `ret` — возврат клиентом, `conf` — confirm (closed).

| Номер | Хронология | Реакция, мин | Расход, ч | В срок |
|---|---|---|---|---|
| 0001 | 02 04:00 создана · 04:30 acc · 04:45 asg ENG1 · 06:00 start · 03 06:00 done (акт A1) · 03 09:00 conf | 30 | 26.0 (лимит 72) | да |
| 0002 | 04 05:00 · 05:20 acc · 05:30 asg ENG2 · 06:00 start · 04 20:00 done (A1) · 05 04:00 **ret** (комм.: «Остался нагрев крайней ячейки») · 05 08:00 done (A2) · 05 10:00 conf (A2) | 20 | 19.0 (15 + 4; лимит 24) | да |
| 0003 | 06 02:00 · 02:10 acc · 02:15 asg ENG1 · 02:30 start · 05:00 **pause** (waiting_parts) · 09:00 res · 13:00 done (A1) · 15:00 conf | 10 | 7.0 (3 + 4; лимит 8) | да |
| 0004 | 09 03:00 · 03:40 acc · 03:50 asg ENG2 · 05:00 start · 12 05:00 done (A1) · 12 08:00 conf | 40 | 74.0 (лимит 72) | **нет** |
| 0005 | 10 05:00 (scheduler) · 07:00 acc · 07:10 asg ENG1 · 11 05:00 start · запрос исключения по фото 11 08:00, одобрено диспетчером 08:20 · 11 09:00 done (A1) · 11 12:00 conf | 120 | 28.0 (лимит 168) | да |
| 0006 | 15 04:00 · 04:30 acc · 04:40 asg ENG2 · 05:00 start · 16 03:00 done (A1) — ждёт клиента | 30 | 23.0 (лимит 24) | да |
| 0007 | 12 06:00 · 06:15 acc · 06:30 asg ENG1 · 08:00 start · 14 08:00 done (A1) — ждёт клиента | 15 | 50.0 (лимит 72) | да |
| 0008 | 16 00:30 · 00:40 acc · 00:50 asg ENG2 · 01:30 start | 10 | 9.5 на `T0` (лимит 8) | **просрочена** |
| 0009 | 15 22:00 · 22:30 acc · 22:40 asg ENG1 · 16 06:00 start | 30 | 12.0 на `T0` (лимит 24) | в работе |
| 0010 | 14 09:00 · 09:30 acc · 10:00 asg ENG2 · 12:00 start | 30 | 49.0 на `T0` (лимит 72) | в работе |
| 0011 | 10 08:00 · 08:20 acc · 08:30 asg ENG2 · 09:00 start · 11 09:00 **pause** (waiting_client: «Требуется окно отключения линии клиентом», действие: «Согласовать окно отключения с клиентом», ожидаемое возобновление 18 06:00) | 20 | 25.0 (стоит; лимит 72) | пауза |
| 0012 | 14 03:00 · 03:30 acc · 03:40 asg ENG1 · 04:00 start · 16:00 **pause** (waiting_parts: «Ожидание ПКТ-10», действие: «Заказать запчасть и подтвердить срок», ожидаемое возобновление 19 04:00) | 30 | 13.0 (стоит; лимит 24) | пауза |
| 0013 | 16 05:00 · 05:30 acc · 05:45 asg ENG1 · 06:00 **reassign → ENG2** (причина: «Инженер 1 занят на другой площадке») | 30 | 5.0 на `T0` | назначена |
| 0014 | 14 05:00 (scheduler) · 07:00 acc · 07:10 asg ENG1 (плановый визит 20 04:00) | 120 | 53.0 на `T0` | назначена |
| 0015 | 16 08:00 · 08:40 acc | 40 | 2.0 на `T0` | принята |
| 0016 | 16 09:30 | — (ждёт, лимит реакции 8 ч) | 0.5 | новая |
| 0017 | 16 08:30 | — (лимит реакции 60 мин, истёк в 09:30) | 1.5 | **просрочена реакция** |
| 0018 | 12 06:20 · 06:50 **reject** (`duplicate`, дубликат SR-2026-0007) | — | — | исключена |
| 0019 | 08 08:00 · 09:00 **cancel** клиентом (причина: «Неисправность устранена силами клиента») | — | — | исключена |
| 0020 | 07 04:00 · 04:30 acc · 05:00 asg ENG2 · 08:00 **cancel** клиентом (причина: «Работы перенесены клиентом») | — | — | исключена |

### 12.5.3. Назначения

Всего **16** записей `assignments`: по одной на заявки 0001–0012, 0014, 0020 (14 записей), две на 0013 (ENG1 — закрыта 06:00 с `reassigned`; ENG2 — активна). Активных 9: 0006, 0007, 0008, 0009, 0010, 0011, 0012, 0013 (ENG2), 0014; закрытых 7: 0001–0005 (`completed`), 0013/ENG1 (`reassigned`), 0020 (`ticket_cancelled`).

| Инженер | Активные назначения на `T0` | Видимые заявки (правило 4.3) |
|---|---|---|
| ENG1 | 0007 (awaiting), 0009, 0012 (paused), 0014 | Активные: 0007, 0009, 0012, 0014; завершённые им: 0001, 0003, 0005 → **7**. Заявка 0013 ему **недоступна** (404) |
| ENG2 | 0006 (awaiting), 0008, 0010, 0011 (paused), 0013 | Активные: 0006, 0008, 0010, 0011, 0013; завершённые им: 0002, 0004 → **7**. Заявка 0020 (отменена) недоступна |

### 12.5.4. Отчёты, чек-листы, запчасти, фото, акты

| Заявка | Ревизии отчёта | Шаблон | Запчасти (кол-во) | Фото (стадии) | Акты |
|---|---|---|---|---|---|
| 0001 | r1 submitted | CT-TR-1 | SP-01 ×20 л; SP-06 ×1 компл. | 3 (before, during, after) | A1 — confirmed |
| 0002 | r1 superseded; r2 submitted | CT-SW-1 | r1: SP-05 ×1; r2: SP-05 ×1, SP-03 ×3 | 3 (before, after, after) | A1 — returned, `is_current=false`; A2 — confirmed |
| 0003 | r1 submitted | CT-TR-2 | SP-04 ×2 | 2 (before, after) | A1 — confirmed |
| 0004 | r1 submitted | CT-TR-2 | SP-02 ×3 кг | 2 (before, after) | A1 — confirmed |
| 0005 | r1 submitted | CT-SS-1 | нет (`parts_confirmed = true`) | 0, **исключение одобрено**: «Съёмка внутри закрытого помещения запрещена правилами площадки» | A1 — confirmed |
| 0006 | r1 submitted | CT-TR-2 | SP-01 ×15 л | 2 (before, after) | A1 — current, без решения |
| 0007 | r1 submitted | CT-SS-1 | SP-03 ×3 | 2 (before, after) | A1 — current, без решения |
| 0008 | r1 draft (диагностика заполнена частично) | CT-SW-1 | — | 1 (before) | — |
| 0009 | r1 draft | CT-SS-1 | — | 1 (before) | — |
| 0010 | r1 draft | CT-SW-1 | — | — | — |
| 0011 | r1 draft (диагноз заполнен) | CT-TR-2 | — | — | — |
| 0012 | r1 draft (диагноз заполнен) | CT-TR-2 | — | — | — |

Итоги: `work_reports` — **13** (submitted — 7: 0001, 0002 r2, 0003, 0004, 0005, 0006, 0007; superseded — 1: 0002 r1; draft — 5: 0008–0012); `part_usages` — **9** строк; `attachments` — **17** (16 фото заявок + 1 документ оборудования); `acts` — **8** (из них `is_current = true`: 0001-A1, 0002-A2, 0003-A1, 0004-A1, 0005-A1, 0006-A1, 0007-A1 = 7; `false`: 0002-A1).

### 12.5.5. Комментарии (5)

| № | Заявка | Автор | Видимость | Время (UTC) | Текст |
|---|---|---|---|---|---|
| 1 | 0001 | U-MGR | internal | 03-03 10:00 | Проверить повторность отказов по оборудованию. |
| 2 | 0010 | U-ENG2 | internal | 03-15 07:00 | Требуется отключение секции, согласовать с клиентом. |
| 3 | 0012 | U-DSP | internal | 03-14 16:30 | Поставщик подтвердил поставку ПКТ-10 на 19.03. |
| 4 | 0008 | U-DSP | public | 03-16 00:55 | Инженер назначен, ожидайте выезда. |
| 5 | 0006 | U-CL1 | public | 03-16 05:00 | Нагрев заметен только в вечерние часы. |

### 12.5.6. Итоговые объёмы seed

| Таблица | Строк |
|---|---|
| organizations / sites / users | 4 / 5 / 8 |
| equipment / maintenance_plans | 10 / 3 |
| spare_parts / checklist_templates | 6 / 4 |
| tickets | 20 |
| ticket_events | **116** (95 событий жизненного цикла + 16 `attachment_added` + 5 `comment_added`) |
| assignments / work_reports | 16 / 13 |
| part_usages / attachments / acts / comments | 9 / 17 / 8 / 5 |
| sla_policies | 4 |

## 12.6. Ожидаемые значения дашборда (на `T0`, период по умолчанию — 30 дней, все заявки попадают в период)

### Для руководителя / диспетчера / администратора (без фильтров)

| Показатель | Значение | Расчёт |
|---|---|---|
| Всего заявок за период | 20 | |
| По статусам | new 2 · accepted 1 · assigned 2 · in_progress 3 · paused 2 · awaiting_confirmation 2 · closed 5 · rejected 1 · cancelled 2 | |
| **Активные** | **12** | 2+1+2+3+2+2 |
| Активные по приоритетам | critical 2 (0008, 0017) · high 4 (0006, 0009, 0012, 0015) · normal 5 (0007, 0010, 0011, 0013, 0016) · low 1 (0014) | |
| **Просроченные** | **2** (resolution 1: SR-0008; reaction 1: SR-0017) | 0008: 9.5 ч > 8 ч; 0017: 90 мин > 60 мин. Прочие активные в пределах лимитов; 0006/0007 не считаются (`awaiting_confirmation`) |
| Ожидают реакции | 2 (0016, 0017) | |
| **Среднее время реакции** | **2 300 с (38 мин 20 с)**, выборка 15 | (30+20+10+40+120+30+15+10+30+30+20+30+30+120+40) = 575 мин; 575/15 |
| **Среднее время до завершения** | **32.43 ч (116 743 с)**, выборка 7 | (26+19+7+74+28+23+50) = 227 ч; 227/7 |
| **Доля в срок** | **85.7%** (6 из 7) | нарушение — только SR-0004 |
| **Загрузка инженеров** | ENG1 **3/4 = 75.0%** (0009, 0012, 0014) · ENG2 **4/4 = 100.0%** (0008, 0010, 0011, 0013) | `awaiting_confirmation` не считается |
| **Повторные неисправности** | **2 из 15 = 13.3%** (SR-0011 после SR-0001; SR-0012 после SR-0004) | знаменатель: corrective без rejected/cancelled = 20 − 2 planned − 1 rejected − 2 cancelled = 15 |
| Закрыто за период | 5 | |
| Плановые даты в ближайшие 14 дней | 2 (EQ-04 — 03-21, EQ-10 — 03-24) | MP-01 (06-09) вне окна |

Выборки: реакция — 0001…0015 (без 0016, 0017 — реакции ещё не было; без 0018, 0019, 0020 — исключены); завершение — 0001…0007; повторные — corrective без rejected/cancelled: 0001–0004, 0006–0013, 0015–0017 (15).

### Для клиентов (метрики 3–5 и 7 считаются по своей организации)

| Организация | Всего | Активные | Просроченные | Реакция (выборка) | До завершения (выборка) | В срок | Повторные |
|---|---|---|---|---|---|---|---|
| C1 «Демо Металл» | 8 | 4 (0006, 0011, 0013, 0014) | 0 | 3 171 с = 52 мин 51 с (7) | 24.00 ч (4) | 4/4 = 100.0% | 1 из 5 = 20.0% |
| C2 «Демо Агро» | 5 | 3 (0007, 0008, 0015) | 1 (0008) | 1 125 с = 18 мин 45 с (4) | 28.50 ч (2) | 2/2 = 100.0% | 0 из 4 = 0.0% |
| C3 «Демо Логистик» | 7 | 5 (0009, 0010, 0012, 0016, 0017) | 1 (0017, реакция) | 1 950 с = 32 мин 30 с (4) | 74.00 ч (1) | 0/1 = 0.0% | 1 из 6 = 16.7% |

Контроль сумм: выборки реакции 7+4+4 = 15 и минуты 370+75+130 = 575; выборки завершения 4+2+1 = 7 и часы 96+57+74 = 227; знаменатели повторных 5+4+6 = 15, повторные 1+0+1 = 2.

## 12.7. Ожидаемые уведомления на `T0`

Правило seed: уведомления создаются тем же кодом, что и в приложении (по событиям и таблице 6.13); `read_at` проставляется всем, созданным **раньше** `T0 − 24 ч` (`2026-03-15T10:00Z`); созданные позже остаются непрочитанными.

| Пользователь | Непрочитанных | Состав |
|---|---|---|
| U-DSP | **9** | `ticket_created`: 0008, 0009, 0013, 0015, 0016, 0017 (6) · `ticket_awaiting_confirmation`: 0006 · `sla_breached`: 0008 · `sla_reaction_breached`: 0017 |
| U-MGR | **2** | `sla_breached` 0008 · `sla_reaction_breached` 0017 |
| U-ENG1 | **3** | `ticket_assigned` 0009 · `ticket_assigned` 0013 (05:45) · `ticket_unassigned` 0013 (06:00) |
| U-ENG2 | **3** | `ticket_assigned` 0008 · `ticket_assigned` 0013 (06:00) · `sla_breached` 0008 |
| U-CL1 | **3** | `ticket_awaiting_confirmation` 0006 · `ticket_accepted` 0013 · `ticket_assigned` 0013 |
| U-CL2 | **4** | `ticket_accepted`, `ticket_assigned`, `ticket_started` 0008 · `ticket_accepted` 0015 |
| U-CL3 | **3** | `ticket_accepted`, `ticket_assigned`, `ticket_started` 0009 |
| U-ADM | **0** | |

## 12.8. Примеры JSON seed

Файлы читаются загрузчиком в порядке зависимостей. Ключи (`key`) преобразуются в UUID через `uuid5`; ссылки между файлами — по ключам.

**`organizations.json` (фрагмент)**

```json
[
  { "key": "ORG-SVC", "kind": "service", "name": "ТОО «Демо-Сервис Энерго»", "short_name": "Демо-Сервис" },
  { "key": "ORG-C1", "kind": "client", "name": "ТОО «Демо Металл»", "short_name": "Демо Металл", "contact_email": "office@demo-metal.test" }
]
```

**`users.json` (фрагмент; пароль подставляется из окружения)**

```json
[
  { "key": "U-ENG2", "email": "engineer2@demo.alageum.test", "full_name": "Инженер Демо-2", "role": "engineer",
    "organization": "ORG-SVC", "phone": "+7 700 000 00 14", "capacity": 4, "password": "${DEMO_USER_PASSWORD}", "must_change_password": false },
  { "key": "U-CL1", "email": "client.metal@demo.alageum.test", "full_name": "Клиент Демо-Металл", "role": "client",
    "organization": "ORG-C1", "phone": "+7 700 000 00 01", "password": "${DEMO_USER_PASSWORD}", "must_change_password": false }
]
```

**`equipment.json` (фрагмент)**

```json
{ "key": "EQ-02", "organization": "ORG-C1", "site": "S1", "type": "substation", "inventory_number": "DM-KTP-0002",
  "name": "КТП-2 400 кВА", "manufacturer": "Демо-Электро", "model": "КТП-400", "serial_number": "DEMO-SN-0002",
  "manufacture_year": 2015, "voltage_class_kv": 10, "rated_power_kva": 400, "technical_state": "degraded",
  "qr_code": "DEMOEQUIP002", "passport_data": { "scheme": "тупиковая", "transformers_count": 1, "cabinets_count": 3 } }
```

**`tickets.json` — SR-2026-0002 с историей, назначением, отчётом и актами**

```json
{
  "key": "T-0002", "number": "SR-2026-0002", "organization": "ORG-C1", "equipment": "EQ-03",
  "kind": "corrective", "source": "web", "urgency": "urgent", "priority": "high", "status": "closed",
  "title": "Перегрев ячейки РУ-6 кВ", "description": "Ячейка №4 заметно нагревается при нагрузке, слышен гул.",
  "created_by": "U-CL1", "created_at": "2026-03-04T05:00:00Z",
  "assignments": [
    { "engineer": "U-ENG2", "assigned_by": "U-DSP", "assigned_at": "2026-03-04T05:30:00Z", "ended_at": "2026-03-05T10:00:00Z", "end_reason": "completed" }
  ],
  "timeline": [
    { "at": "2026-03-04T05:00:00Z", "type": "created", "actor": "U-CL1" },
    { "at": "2026-03-04T05:20:00Z", "type": "accepted", "actor": "U-DSP", "to_status": "accepted", "payload": { "priority": "high" } },
    { "at": "2026-03-04T05:30:00Z", "type": "assigned", "actor": "U-DSP", "to_status": "assigned", "payload": { "engineer": "U-ENG2" } },
    { "at": "2026-03-04T06:00:00Z", "type": "started", "actor": "U-ENG2", "to_status": "in_progress" },
    { "at": "2026-03-04T20:00:00Z", "type": "completed", "actor": "U-ENG2", "to_status": "awaiting_confirmation", "payload": { "report_revision": 1, "consumed_seconds": 54000 } },
    { "at": "2026-03-04T20:00:00Z", "type": "act_generated", "actor": "U-ENG2", "payload": { "act": "ACT-0002-1", "version": 1 } },
    { "at": "2026-03-05T04:00:00Z", "type": "returned", "actor": "U-CL1", "from_status": "awaiting_confirmation", "to_status": "in_progress",
      "comment": "Остался нагрев крайней ячейки, прошу проверить контакты.", "payload": { "act": "ACT-0002-1" } },
    { "at": "2026-03-05T08:00:00Z", "type": "completed", "actor": "U-ENG2", "to_status": "awaiting_confirmation", "payload": { "report_revision": 2, "consumed_seconds": 68400 } },
    { "at": "2026-03-05T08:00:00Z", "type": "act_generated", "actor": "U-ENG2", "payload": { "act": "ACT-0002-2", "version": 2 } },
    { "at": "2026-03-05T10:00:00Z", "type": "confirmed", "actor": "U-CL1", "to_status": "closed", "payload": { "act": "ACT-0002-2", "rating": 5 } }
  ],
  "sla": { "reaction_limit_seconds": 14400, "resolution_limit_seconds": 86400, "first_reacted_at": "2026-03-04T05:20:00Z",
           "completed_consumed_seconds": 68400, "resolved_within_sla": true },
  "return_count": 1
}
```

**`reports.json` — ревизия 2 отчёта по SR-2026-0002**

```json
{
  "key": "R-0002-2", "ticket": "T-0002", "revision": 2, "status": "submitted", "author": "U-ENG2",
  "checklist_template": "CT-SW-1",
  "checklist_answers": {
    "cells_clean_ok": { "value": true },
    "breaker_operation_ok": { "value": true },
    "interlocks_ok": { "value": true },
    "relay_protection_ok": { "value": true },
    "contacts_heating_ok": { "value": true, "comment": "После подтяжки контактов нагрев в норме (тепловизор)." },
    "insulation_mohm": { "value": 850 },
    "grounding_ok": { "value": true },
    "notes": { "value": "Рекомендована повторная проверка через 30 дней." }
  },
  "diagnosis": "Ослабление контактных соединений в ячейке №4 и крайней ячейке, локальный нагрев до 78 °C.",
  "work_performed": "Подтянуты контактные соединения, заменён контактор, заменены предохранители, выполнена проверка тепловизором.",
  "result_code": "resolved_with_remarks", "result_summary": "Нагрев устранён.",
  "recommendations": "Повторная тепловизионная проверка через 30 дней.",
  "labor_minutes": 210, "parts_confirmed": true, "photo_exception_status": "none",
  "submitted_at": "2026-03-05T08:00:00Z",
  "parts": [
    { "part": "SP-05", "quantity": 1, "comment": "Заменён контактор ячейки №4" },
    { "part": "SP-03", "quantity": 3 }
  ]
}
```

**`acts.json`**

```json
[
  { "key": "ACT-0002-1", "ticket": "T-0002", "report": "R-0002-1", "version": 1, "is_current": false,
    "generated_at": "2026-03-04T20:00:00Z", "decision": "returned", "decided_by": "U-CL1", "decided_at": "2026-03-05T04:00:00Z",
    "superseded_at": "2026-03-05T04:00:00Z" },
  { "key": "ACT-0002-2", "ticket": "T-0002", "report": "R-0002-2", "version": 2, "is_current": true,
    "generated_at": "2026-03-05T08:00:00Z", "decision": "confirmed", "decided_by": "U-CL1", "decided_at": "2026-03-05T10:00:00Z", "rating": 5 }
]
```

PDF актов генерируются при загрузке реальным шаблоном из `data_snapshot`, собираемого из этих записей; `sha256` вычисляется после генерации.

**`attachments.json` (спецификации генерации)**

```json
[
  { "key": "A-0002-1", "ticket": "T-0002", "report": "R-0002-1", "kind": "photo", "stage": "before", "uploaded_by": "U-ENG2",
    "uploaded_at": "2026-03-04T06:10:00Z", "generator": { "type": "placeholder_png", "label": "DEMO 0002 before" } },
  { "key": "D-EQ01", "equipment": "EQ-01", "kind": "document", "uploaded_by": "U-DSP", "uploaded_at": "2026-02-20T09:00:00Z",
    "original_filename": "Паспорт изделия (демо).pdf", "generator": { "type": "placeholder_pdf", "title": "Паспорт изделия (демо)" } }
]
```

## 12.9. Проверка seed

| Проверка | Как |
|---|---|
| Согласованность связей | После загрузки выполняется набор SQL-инвариантов: оборудование ↔ площадка ↔ организация; заявка ↔ оборудование ↔ организация; `assigned_engineer_id` = активное назначение; CHECK-инварианты `tickets`; один `is_current` акт на заявку; `SUM` частей по отчётам; наличие файлов и совпадение `sha256` (`verify-storage`) |
| Совпадение аналитики | Интеграционный тест IT-30 сравнивает `/analytics/*` с таблицами 12.6 |
| Повторяемость | IT-32: двойной запуск → равные счётчики таблиц (12.5.6) и тот же набор хэшей данных |
| Запрет | IT-32/OP-06: запуск при `APP_ENV=pilot` и при `deployment_mode='pilot'` завершается кодом 2 без изменений |

## 12.10. Критерии приёмки раздела

| № | Критерий | Тест |
|---|---|---|
| 12-1 | После `seed-demo` счётчики таблиц равны 12.5.6, инварианты 12.9 выполняются | IT-32 |
| 12-2 | Дашборд при `T0` совпадает с 12.6 для руководителя и каждого клиента | IT-30, IT-31, E2E-07 |
| 12-3 | Непрочитанные уведомления совпадают с 12.7 | IT-26 |
| 12-4 | Видимость заявок: ENG1 — 7, ENG2 — 7, C1 — 8, C2 — 5, C3 — 7 | IT-03, IT-04 |
| 12-5 | Seed не меняет данные при втором запуске и не запускается в пилоте | IT-32, OP-06 |
