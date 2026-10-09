"""Базовые шаблоны чек-листов (демонстрационные, требуют согласования с компанией — D-08)."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models import ChecklistTemplate

B = lambda key, section, label, flag=True: {  # noqa: E731
    "key": key, "section": section, "label": label, "type": "boolean", "required": True,
    **({"flag_if": {"equals": False}} if flag else {})}
N = lambda key, section, label, unit, mn, mx, req=True, flag=None: {  # noqa: E731
    "key": key, "section": section, "label": label, "type": "number", "unit": unit, "min": mn, "max": mx,
    "required": req, **({"flag_if": flag} if flag else {})}
NOTES = {"key": "notes", "section": "Прочее", "label": "Замечания", "type": "text", "required": False}

TR_V2 = [
    B("oil_leak", "Визуальный осмотр", "Течь масла отсутствует"),
    {"key": "oil_level", "section": "Визуальный осмотр", "label": "Уровень масла по указателю", "type": "enum", "required": True,
     "options": [{"value": "low", "label": "Ниже нормы", "flag": True}, {"value": "normal", "label": "Норма"},
                 {"value": "high", "label": "Выше нормы", "flag": True}]},
    B("bushings_ok", "Визуальный осмотр", "Вводы без трещин и загрязнений"),
    N("oil_temp_c", "Измерения", "Температура верхних слоёв масла", "°C", -50, 150, True, {"gt": 85}),
    N("load_current_a", "Измерения", "Ток нагрузки", "А", 0, 5000, False),
    N("insulation_mohm", "Измерения", "Сопротивление изоляции", "МОм", 0, 100000, True, {"lt": 100}),
    B("grounding_ok", "Безопасность", "Заземление в порядке"),
    NOTES,
]
TR_V1 = [i for i in TR_V2 if i["key"] not in ("bushings_ok", "load_current_a")]
SS = [
    B("enclosure_ok", "Визуальный осмотр", "Корпус и двери без повреждений"),
    B("ventilation_ok", "Визуальный осмотр", "Вентиляция не загрязнена"),
    {"key": "breaker_state", "section": "Визуальный осмотр", "label": "Положение коммутационных аппаратов", "type": "enum",
     "required": True, "options": [{"value": "normal", "label": "Штатное"}, {"value": "abnormal", "label": "Нештатное", "flag": True}]},
    B("fuses_ok", "Визуальный осмотр", "Предохранители целы"),
    B("contacts_heating_ok", "Измерения", "Нагрев контактов не выявлен (тепловизор)"),
    N("insulation_mohm", "Измерения", "Сопротивление изоляции", "МОм", 0, 100000, True, {"lt": 100}),
    B("grounding_ok", "Безопасность", "Заземление в порядке"),
    NOTES,
]
SW = [
    B("cells_clean_ok", "Визуальный осмотр", "Ячейки чистые, без следов перегрева"),
    B("breaker_operation_ok", "Проверки", "Пробное включение/отключение выполнено"),
    B("interlocks_ok", "Проверки", "Блокировки исправны"),
    B("relay_protection_ok", "Проверки", "Релейная защита исправна"),
    B("contacts_heating_ok", "Измерения", "Нагрев контактов не выявлен (тепловизор)"),
    N("insulation_mohm", "Измерения", "Сопротивление изоляции", "МОм", 0, 100000, True, {"lt": 100}),
    B("grounding_ok", "Безопасность", "Заземление в порядке"),
    NOTES,
]

BASE = [
    ("transformer_inspection", "transformer", "Осмотр силового трансформатора", TR_V1),
    ("substation_inspection", "substation", "Осмотр комплектной подстанции (КТП)", SS),
    ("switchgear_inspection", "switchgear", "Осмотр распределительного устройства", SW),
]
TR_V2_TEMPLATE = ("transformer_inspection", "transformer", "Осмотр силового трансформатора", TR_V2)


def ensure_templates(db) -> None:
    """Активные шаблоны v1 для трёх типов оборудования (если ещё нет)."""
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)
    from app import clock
    now = min(now, clock.now())
    for code, etype, title, items in BASE:
        if not db.scalar(select(ChecklistTemplate.id).where(ChecklistTemplate.code == code)):
            db.add(ChecklistTemplate(code=code, version=1, equipment_type=etype, title=title, schema={"items": items},
                                     status="active", created_at=now, published_at=now))
    db.flush()
