"""Demo-данные (раздел 12). Атомарная загрузка: все изменения — в транзакции вызывающего."""
import io
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS_

from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from sqlalchemy import func, select, text

from app import clock, jobs, notifications, storage, workflow
from app.models import (Attachment, ChecklistTemplate, Comment, Equipment, MaintenancePlan, Notification, Organization,
                        PartUsage, Site, SparePart, Ticket, User, WorkReport)
from app.routers.files import process_upload
from app.security import Ctx, hash_password
from app.execution import draft_report
from .templates import TR_V2, ensure_templates

SEED_VERSION = "1"
NAMESPACE = uuid.UUID("a1a9e000-0000-5000-8000-000000000001")
UTC = timezone.utc
T0 = datetime(2026, 3, 16, 10, 0, tzinfo=UTC)


def uid(kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"{kind}:{key}")


def T(s: str) -> datetime:  # "03-16 10:00"
    d, h = s.split()
    m, dd = d.split("-")
    hh, mm = h.split(":")
    return datetime(2026, int(m), int(dd), int(hh), int(mm), tzinfo=UTC)


ORGS = [("ORG-SVC", "service", "ТОО «Демо-Сервис Энерго»", "Демо-Сервис"),
        ("ORG-C1", "client", "ТОО «Демо Металл»", "Демо Металл"),
        ("ORG-C2", "client", "ТОО «Демо Агро»", "Демо Агро"),
        ("ORG-C3", "client", "ТОО «Демо Логистик»", "Демо Логистик")]
USERS = [("ADM", "admin@demo.alageum.test", "Админ Демо", "admin", "ORG-SVC", "+7 700 000 00 10"),
         ("DSP", "dispatcher@demo.alageum.test", "Диспетчер Демо", "dispatcher", "ORG-SVC", "+7 700 000 00 11"),
         ("MGR", "manager@demo.alageum.test", "Руководитель Демо", "manager", "ORG-SVC", "+7 700 000 00 12"),
         ("ENG1", "engineer1@demo.alageum.test", "Инженер Демо-1", "engineer", "ORG-SVC", "+7 700 000 00 13"),
         ("ENG2", "engineer2@demo.alageum.test", "Инженер Демо-2", "engineer", "ORG-SVC", "+7 700 000 00 14"),
         ("CL1", "client.metal@demo.alageum.test", "Клиент Демо-Металл", "client", "ORG-C1", "+7 700 000 00 01"),
         ("CL2", "client.agro@demo.alageum.test", "Клиент Демо-Агро", "client", "ORG-C2", "+7 700 000 00 02"),
         ("CL3", "client.logistics@demo.alageum.test", "Клиент Демо-Логистик", "client", "ORG-C3", "+7 700 000 00 03")]
SITES = [("S1", "ORG-C1", "Площадка «Металл-Север»", "г. Шымкент, ул. Условная, 1"),
         ("S2", "ORG-C1", "Площадка «Металл-Юг»", "г. Шымкент, ул. Условная, 25"),
         ("S3", "ORG-C2", "Ферма «Агро-1»", "Шымкент, пригород, участок 3"),
         ("S4", "ORG-C2", "Элеватор «Агро-2»", "Шымкент, пригород, участок 7"),
         ("S5", "ORG-C3", "Склад «Логистик-Центр»", "г. Шымкент, пр. Тестовый, 10")]
# координаты площадок для карты OpenStreetMap (демо: Шымкент)
SITE_GEO = {"S1": (42.3652, 69.5583), "S2": (42.3048, 69.6104), "S3": (42.4301, 69.7126), "S4": (42.2397, 69.5208), "S5": (42.3304, 69.6502)}
# key, org, site, type, inv, name, kva, kv, state
EQUIP = [("EQ-01", "ORG-C1", "S1", "transformer", "DM-TR-0001", "Трансформатор ТМ-1000/10", 1000, 10, "operational"),
         ("EQ-02", "ORG-C1", "S1", "substation", "DM-KTP-0002", "КТП-2 400 кВА", 400, 10, "degraded"),
         ("EQ-03", "ORG-C1", "S2", "switchgear", "DM-RU-0003", "РУ-6 кВ, 12 ячеек", None, 6, "operational"),
         ("EQ-04", "ORG-C1", "S2", "transformer", "DM-TR-0004", "Трансформатор ТМ-630/10", 630, 10, "operational"),
         ("EQ-05", "ORG-C2", "S3", "transformer", "DA-TR-0001", "Трансформатор ТМ-400/10", 400, 10, "operational"),
         ("EQ-06", "ORG-C2", "S3", "substation", "DA-KTP-0002", "КТП-250", 250, 10, "operational"),
         ("EQ-07", "ORG-C2", "S4", "switchgear", "DA-RU-0003", "РУ-0,4 кВ элеватора", None, 0.4, "out_of_service"),
         ("EQ-08", "ORG-C3", "S5", "transformer", "DL-TR-0001", "Трансформатор ТМ-250/10", 250, 10, "degraded"),
         ("EQ-09", "ORG-C3", "S5", "substation", "DL-KTP-0002", "КТП-160", 160, 10, "operational"),
         ("EQ-10", "ORG-C3", "S5", "switchgear", "DL-RU-0003", "РУ-10 кВ, 8 ячеек", None, 10, "operational")]
PARTS = [("SP-01", "SP-OIL-01", "Масло трансформаторное", "l"), ("SP-02", "SP-SIL-01", "Силикагель-осушитель", "kg"),
         ("SP-03", "SP-FUS-10", "Предохранитель ПКТ-10", "pcs"), ("SP-04", "SP-INS-01", "Изолятор опорный", "pcs"),
         ("SP-05", "SP-CNT-01", "Контактор трёхполюсный", "pcs"), ("SP-06", "SP-GSK-01", "Прокладка уплотнительная (комплект)", "set")]
PLANS = [("MP-01", "EQ-02", "ТО-1 КТП", 90, "2026-03-17", None), ("MP-02", "EQ-04", "Профилактический осмотр трансформатора", 180, "2026-03-21", "2025-09-22"),
         ("MP-03", "EQ-10", "Осмотр РУ-10 кВ", 90, "2026-03-24", "2025-12-24")]

# n, org-клиент, eq, title, desc, urgency, priority, creator, created, plan, steps
TICKETS = [
    (1, "EQ-01", "Течь масла на трансформаторе", "Обнаружены следы масла на баке и под трансформатором.", "planned", "normal", "CL1", "03-02 04:00", None,
     [("acc", "03-02 04:30"), ("asg", "03-02 04:45", "ENG1"), ("start", "03-02 06:00"), ("done", "03-03 06:00"), ("conf", "03-03 09:00", 5, "Работы приняты.")]),
    (2, "EQ-03", "Перегрев ячейки РУ-6 кВ", "Ячейка №4 заметно нагревается при нагрузке, слышен гул.", "urgent", "high", "CL1", "03-04 05:00", None,
     [("acc", "03-04 05:20"), ("asg", "03-04 05:30", "ENG2"), ("start", "03-04 06:00"), ("done", "03-04 20:00"),
      ("ret", "03-05 04:00", "Остался нагрев крайней ячейки, прошу проверить контакты."), ("done", "03-05 08:00"), ("conf", "03-05 10:00", 5, "Замечание устранено.")]),
    (3, "EQ-05", "Аварийное отключение трансформатора", "Трансформатор отключился действием защиты, питание объекта потеряно.", "emergency", "critical", "CL2", "03-06 02:00", None,
     [("acc", "03-06 02:10"), ("asg", "03-06 02:15", "ENG1"), ("start", "03-06 02:30"),
      ("pause", "03-06 05:00", "waiting_parts", "Требуется замена изолятора, на объекте нужного нет.", "Доставить изолятор со склада сервиса.", "03-06 09:00"),
      ("res", "03-06 09:00"), ("done", "03-06 13:00"), ("conf", "03-06 15:00", 4, None)]),
    (4, "EQ-08", "Повышенный уровень шума трансформатора", "Гул трансформатора усилился в течение недели.", "planned", "normal", "CL3", "03-09 03:00", None,
     [("acc", "03-09 03:40"), ("asg", "03-09 03:50", "ENG2"), ("start", "03-09 05:00"), ("done", "03-12 05:00"), ("conf", "03-12 08:00", 4, None)]),
    (5, "EQ-02", "Плановое ТО: ТО-1 КТП", "Плановые работы по графику: ТО-1 КТП.", "planned", "low", None, "03-10 05:00", ("MP-01", "2026-03-17"),
     [("acc", "03-10 07:00"), ("asg", "03-10 07:10", "ENG1"), ("start", "03-11 05:00"), ("pex_req", "03-11 08:00"), ("pex_ok", "03-11 08:20"),
      ("done", "03-11 09:00"), ("conf", "03-11 12:00", 5, None)]),
    (6, "EQ-04", "Нагрев вводов трансформатора", "Вводы горячие на ощупь, температура выше обычной.", "urgent", "high", "CL1", "03-15 04:00", None,
     [("acc", "03-15 04:30"), ("asg", "03-15 04:40", "ENG2"), ("start", "03-15 05:00"), ("done", "03-16 03:00")]),
    (7, "EQ-06", "Срабатывание защиты КТП", "Защита КТП срабатывает при пуске двигателей.", "planned", "normal", "CL2", "03-12 06:00", None,
     [("acc", "03-12 06:15"), ("asg", "03-12 06:30", "ENG1"), ("start", "03-12 08:00"), ("done", "03-14 08:00")]),
    (8, "EQ-07", "Отказ вводного автомата РУ-0,4 кВ", "Вводной автомат не включается, элеватор без питания.", "emergency", "critical", "CL2", "03-16 00:30", None,
     [("acc", "03-16 00:40"), ("asg", "03-16 00:50", "ENG2"), ("start", "03-16 01:30")]),
    (9, "EQ-09", "Искрение на шинах КТП", "На шинах КТП заметно искрение при нагрузке.", "urgent", "high", "CL3", "03-15 22:00", None,
     [("acc", "03-15 22:30"), ("asg", "03-15 22:40", "ENG1"), ("start", "03-16 06:00")]),
    (10, "EQ-10", "Не включается секционный выключатель РУ-10 кВ", "Секционный выключатель не включается дистанционно.", "planned", "normal", "CL3", "03-14 09:00", None,
     [("acc", "03-14 09:30"), ("asg", "03-14 10:00", "ENG2"), ("start", "03-14 12:00")]),
    (11, "EQ-01", "Повторная течь масла", "Течь масла возобновилась после предыдущего ремонта.", "planned", "normal", "CL1", "03-10 08:00", None,
     [("acc", "03-10 08:20"), ("asg", "03-10 08:30", "ENG2"), ("start", "03-10 09:00"),
      ("pause", "03-11 09:00", "waiting_client", "Требуется окно отключения линии клиентом.", "Согласовать окно отключения с клиентом.", "03-18 06:00")]),
    (12, "EQ-08", "Перегорание предохранителей ПКТ-10", "Перегорают предохранители ПКТ-10 на вводе.", "urgent", "high", "CL3", "03-14 03:00", None,
     [("acc", "03-14 03:30"), ("asg", "03-14 03:40", "ENG1"), ("start", "03-14 04:00"),
      ("pause", "03-14 16:00", "waiting_parts", "Ожидание поставки предохранителей ПКТ-10.", "Заказать запчасть и подтвердить срок поставки.", "03-19 04:00")]),
    (13, "EQ-02", "Повышенный шум в КТП", "При работе слышен периодический гул, температура корпуса выше обычной.", "planned", "normal", "CL1", "03-16 05:00", None,
     [("acc", "03-16 05:30"), ("asg", "03-16 05:45", "ENG1"), ("reasg", "03-16 06:00", "ENG2", "Инженер 1 занят на другой площадке")]),
    (14, "EQ-04", "Плановый профилактический осмотр трансформатора", "Плановые работы по графику: профилактический осмотр.", "planned", "low", None, "03-14 05:00", ("MP-02", "2026-03-21"),
     [("acc", "03-14 07:00"), ("asg", "03-14 07:10", "ENG1", "03-20 04:00")]),
    (15, "EQ-06", "Запах гари у шкафа КТП", "Ощущается запах гари возле шкафа КТП.", "urgent", "high", "CL2", "03-16 08:00", None, [("acc", "03-16 08:40")]),
    (16, "EQ-10", "Показания приборов РУ-10 кВ нестабильны", "Показания вольтметров на РУ-10 кВ скачут.", "planned", "normal", "CL3", "03-16 09:30", None, []),
    (17, "EQ-09", "Отключение вводного шкафа КТП-160", "Вводной шкаф КТП-160 отключился, объект без питания.", "emergency", "critical", "CL3", "03-16 08:30", None, []),
    (18, "EQ-06", "Срабатывание защиты КТП (повторное обращение)", "Защита КТП срабатывает при пуске двигателей.", "planned", "normal", "CL2", "03-12 06:20", None,
     [("rej", "03-12 06:50", "duplicate", "Дубликат заявки SR-2026-0007, работы по ней уже ведутся.")]),
    (19, "EQ-03", "Мигает индикация РУ-6 кВ", "Индикация на панели РУ-6 кВ периодически мигает.", "planned", "normal", "CL1", "03-08 08:00", None,
     [("cancel", "03-08 09:00", "CL1", "Неисправность устранена силами клиента.")]),
    (20, "EQ-09", "Осмотр КТП-160 по графику клиента", "Осмотр КТП-160 по внутреннему графику клиента.", "planned", "normal", "CL3", "03-07 04:00", None,
     [("acc", "03-07 04:30"), ("asg", "03-07 05:00", "ENG2"), ("cancel", "03-07 08:00", "CL3", "Работы перенесены клиентом на другой срок.")]),
]

# отчёты: n -> список ревизий {diag, work, res, summary, recs, labor, parts, photos, over}
REPORTS = {
    1: [dict(diag="Течь масла через уплотнение крышки бака, уровень масла снижен.", work="Заменена прокладка крышки, долито трансформаторное масло, проверена герметичность.",
             res="resolved", summary="Течь устранена.", labor=180, parts=[("SP-01", 20), ("SP-06", 1)],
             photos=[("before", "03-02 06:10"), ("during", "03-02 10:00"), ("after", "03-03 05:30")])],
    2: [dict(diag="Ослабление контактных соединений в ячейке №4, локальный нагрев до 78 °C.", work="Подтянуты контактные соединения, заменён контактор ячейки №4.",
             res="resolved", summary="Нагрев устранён.", labor=150, parts=[("SP-05", 1)], photos=[("before", "03-04 06:10"), ("after", "03-04 19:30")]),
        dict(diag="Ослабление контактов в ячейке №4 и в крайней ячейке, локальный нагрев до 78 °C.",
             work="Подтянуты контакты в обеих ячейках, заменены контактор и предохранители, выполнена проверка тепловизором.",
             res="resolved_with_remarks", summary="Нагрев устранён.", recs="Повторная тепловизионная проверка через 30 дней.", labor=210,
             parts=[("SP-05", 1), ("SP-03", 3)], photos=[("after", "03-05 07:30")],
             over={"contacts_heating_ok": {"value": True, "comment": "После подтяжки нагрев в норме (тепловизор)."}})],
    3: [dict(diag="Пробой опорного изолятора, срабатывание защиты трансформатора.", work="Заменены два опорных изолятора, проверена изоляция, трансформатор включён.",
             res="resolved", summary="Питание восстановлено.", labor=240, parts=[("SP-04", 2)], photos=[("before", "03-06 02:50"), ("after", "03-06 12:30")])],
    4: [dict(diag="Ослабление крепления магнитопровода, увлажнение силикагеля в воздухоосушителе.", work="Подтянуты крепёжные элементы, заменён силикагель воздухоосушителя.",
             res="resolved", summary="Шум снижен до нормы.", labor=200, parts=[("SP-02", 3)], photos=[("before", "03-09 05:20"), ("after", "03-12 04:30")])],
    5: [dict(diag="Плановый осмотр КТП: замечаний к состоянию оборудования не выявлено.", work="Выполнен осмотр, проверка контактов тепловизором, измерение сопротивления изоляции.",
             res="resolved", summary="Оборудование исправно.", labor=120, parts=[], photos=[], pex="Съёмка внутри закрытого помещения запрещена правилами площадки.")],
    6: [dict(diag="Загрязнение и ослабление контактов вводов, нагрев до 70 °C.", work="Очищены вводы, подтянуты контактные соединения, долито масло.",
             res="resolved", summary="Нагрев устранён.", labor=160, parts=[("SP-01", 15)], photos=[("before", "03-15 05:20"), ("after", "03-16 02:30")])],
    7: [dict(diag="Ложные срабатывания защиты из-за перегоревших предохранителей и ослабленных контактов.", work="Заменены предохранители ПКТ-10, проверены уставки защиты.",
             res="resolved", summary="Защита работает штатно.", labor=190, parts=[("SP-03", 3)], photos=[("before", "03-12 08:20"), ("after", "03-14 07:30")])],
}
DRAFTS = {8: ("Вводной автомат не включается, следы оплавления контактов.", [("before", "03-16 01:45")]),
          9: ("Искрение вызвано ослаблением крепления шины на вводе.", [("before", "03-16 06:15")]),
          10: ("Механизм привода секционного выключателя заклинивает при включении.", []),
          11: ("Течь по сварному шву бака, требуется отключение для ремонта.", []),
          12: ("Предохранители перегорают из-за перегрузки одной из фаз.", [])}
COMMENTS = [(1, "MGR", "internal", "03-03 10:00", "Проверить повторность отказов по оборудованию."),
            (10, "ENG2", "internal", "03-15 07:00", "Требуется отключение секции, согласовать с клиентом."),
            (12, "DSP", "internal", "03-14 16:30", "Поставщик подтвердил поставку ПКТ-10 на 19.03."),
            (8, "DSP", "public", "03-16 00:55", "Инженер назначен, ожидайте выезда."),
            (6, "CL1", "public", "03-16 05:00", "Нагрев заметен только в вечерние часы.")]


def default_answers(schema: dict, over: dict | None = None) -> dict:
    out = {}
    for i in schema["items"]:
        k, t = i["key"], i["type"]
        if t == "boolean":
            out[k] = {"value": True}
        elif t == "number":
            presets = {"oil_temp_c": 62.5, "load_current_a": 420, "insulation_mohm": 850}
            out[k] = {"value": presets.get(k, round(i.get("min", 0) + (i.get("max", 100) - i.get("min", 0)) * 0.3, 1))}
        elif t == "enum":
            ok = [o for o in i["options"] if not o.get("flag")]
            out[k] = {"value": ok[0]["value"]}
    out.update(over or {})
    return out


def placeholder_photo(label: str) -> bytes:
    im = Image.new("RGB", (800, 600), (22, 58, 104))
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, 780, 580], outline=(94, 234, 212), width=6)
    d.text((60, 260), "DEMO PHOTO", fill=(255, 255, 255))
    d.text((60, 300), label, fill=(94, 234, 212))
    b = io.BytesIO()
    im.save(b, format="PNG")
    return b.getvalue()


def placeholder_pdf(title: str) -> bytes:
    from app import pdf
    pdf._register()
    b = io.BytesIO()
    c = canvas.Canvas(b)
    c.setFont(pdf.FONT_B, 16)
    c.drawString(60, 780, title)
    c.setFont(pdf.FONT, 10)
    c.drawString(60, 750, "Демонстрационный документ. Содержимое условное.")
    c.save()
    return b.getvalue()


def load(db, demo_password: str) -> dict:
    ensure_templates(db)
    O, U, S, E, P, PL = {}, {}, {}, {}, {}, {}
    pw_hash = hash_password(demo_password)
    for key, kind, name, short in ORGS:
        o = db.scalar(select(Organization).where(Organization.name == name))
        if not o:
            o = Organization(id=uid("org", key), kind=kind, name=name, short_name=short, created_at=T("01-05 08:00"), updated_at=T("01-05 08:00"))
            db.add(o)
        O[key] = o
    db.flush()
    for key, email, name, role, org, phone in USERS:
        u = db.scalar(select(User).where(User.email == email))
        if not u:
            u = User(id=uid("user", key), organization_id=O[org].id, email=email, full_name=name, role=role, phone=phone,
                     password_hash=pw_hash, must_change_password=False, capacity=4,
                     created_at=T("01-05 08:00"), updated_at=T("01-05 08:00"))
            db.add(u)
        U[key] = u
    for key, org, name, addr in SITES:
        s = Site(id=uid("site", key), organization_id=O[org].id, name=name, address=addr, latitude=SITE_GEO[key][0], longitude=SITE_GEO[key][1],
                 created_at=T("01-05 08:00"), updated_at=T("01-05 08:00"))
        db.add(s)
        S[key] = s
    db.flush()
    per_site: dict[str, int] = {}
    for i, (key, org, site, typ, inv, name, kva, kv, state) in enumerate(EQUIP, 1):
        j = per_site[site] = per_site.get(site, 0) + 1
        dlat, dlon = [(0.0, 0.0), (0.0007, 0.0009), (-0.0007, 0.0011), (0.0012, -0.0008)][min(j - 1, 3)]   # демо: оборудование на площадке разнесено
        e = Equipment(latitude=round(SITE_GEO[site][0] + dlat, 6), longitude=round(SITE_GEO[site][1] + dlon, 6), id=uid("equipment", key), organization_id=O[org].id, site_id=S[site].id, type=typ, inventory_number=inv,
                      name=name, manufacturer="Демо-Электро", model=(__import__("re").search(r"[А-ЯA-Z]{1,4}-[\d,/]+", name) or [None])[0],
                      serial_number=f"DEMO-SN-{i:04d}", manufacture_year=2008 + i, voltage_class_kv=kv, rated_power_kva=kva,
                      technical_state=state, qr_code=f"DEMOEQUIP{i:03d}", passport_data={},
                      created_at=T("01-10 08:00"), updated_at=T("01-10 08:00"))
        db.add(e)
        E[key] = e
    for key, sku, name, unit in PARTS:
        p = SparePart(id=uid("part", key), sku=sku, name=name, unit=unit, created_at=T("01-10 08:00"), updated_at=T("01-10 08:00"))
        db.add(p)
        P[sku], P[key] = p, p
    db.flush()
    for key, eq, title, interval, due, last in PLANS:
        pl = MaintenancePlan(id=uid("plan", key), equipment_id=E[eq].id, title=title, interval_days=interval, lead_days=7,
                             priority="low", next_due_date=datetime.fromisoformat(due).date(),
                             last_done_on=datetime.fromisoformat(last).date() if last else None,
                             created_by=U["DSP"].id, created_at=T("01-10 08:00"), updated_at=T("01-10 08:00"))
        db.add(pl)
        PL[key] = pl
    db.flush()
    eq_doc(db, E["EQ-01"], U["DSP"])

    flipped = False
    ctxs = {k: Ctx(u, None, uuid.uuid4()) for k, u in U.items()}
    tickets = {}
    for (n, eqk, title, desc, urg, prio, creator, created, plan, steps) in TICKETS:
        if not flipped and T(created) >= T("03-05 00:00"):
            publish_tr_v2(db)
            flipped = True
        eq = E[eqk]
        number = f"SR-2026-{n:04d}"
        pl = PL[plan[0]] if plan else None
        t = workflow.create_ticket_core(
            db, eq, title=title, description=desc, urgency=urg, priority=prio, kind="planned" if plan else "corrective",
            source="scheduler" if plan else "web", created_by=U[creator] if creator else None, now=T(created),
            contact_name=U[creator].full_name if creator else None, contact_phone=U[creator].phone if creator else None,
            plan=pl, plan_due_date=datetime.fromisoformat(plan[1]).date() if plan else None, number=number,
            ticket_id=uid("ticket", number))
        tickets[n] = t
        rev = 0
        for st in steps:
            kind, at = st[0], T(st[1])
            w = []
            if kind == "acc":
                workflow._do_accept(db, ctxs["DSP"], t, NS_(priority=prio), at, w)
            elif kind == "asg":
                sched = T(st[3]) if len(st) > 3 else None
                workflow._do_assign(db, ctxs["DSP"], t, NS_(engineer_id=U[st[2]].id, priority=None, scheduled_at=sched, comment=None), at, w)
            elif kind == "reasg":
                workflow._do_reassign(db, ctxs["DSP"], t, NS_(engineer_id=U[st[2]].id, reason=st[3]), at, w)
            elif kind == "start":
                workflow._do_start(db, ctxs[eng_of(t, U)], t, NS_(), at, w)
            elif kind == "pause":
                workflow._do_pause(db, ctxs[eng_of(t, U)], t, NS_(reason_code=st[2], comment=st[3], next_action=st[4],
                                                                 expected_resume_at=T(st[5])), at, w)
            elif kind == "res":
                workflow._do_resume(db, ctxs[eng_of(t, U)], t, NS_(comment=None), at, w)
            elif kind == "pex_req":
                r = draft_report(db, t.id)
                r.photo_exception_status, r.photo_exception_reason = "requested", REPORTS[n][0]["pex"]
                workflow.add_event(db, t, "photo_exception_requested", at, actor=U[eng_of(t, U)], visibility="internal", comment=r.photo_exception_reason)
                notifications.emit(db, "photo_exception_requested", t, at, actor_id=t.assigned_engineer_id)
            elif kind == "pex_ok":
                r = draft_report(db, t.id)
                r.photo_exception_status, r.photo_exception_decided_by, r.photo_exception_decided_at = "approved", U["DSP"].id, at
                workflow.add_event(db, t, "photo_exception_approved", at, actor=U["DSP"], visibility="internal")
                notifications.emit(db, "photo_exception_decided", t, at, actor_id=U["DSP"].id, body="Решение: approved")
            elif kind == "done":
                fill_report(db, t, REPORTS[n][rev], U, at)
                workflow._do_complete(db, ctxs[eng_of(t, U)], t, NS_(), at, w)
                rev += 1
            elif kind == "ret":
                workflow._do_return(db, ctxs[creator], t, NS_(act_id=current_act_id(db, t), comment=st[2]), at, w)
            elif kind == "conf":
                workflow._do_confirm(db, ctxs[creator or "CL1"], t, NS_(act_id=current_act_id(db, t), rating=st[2], comment=st[3]), at, w)
            elif kind == "rej":
                workflow._do_reject(db, ctxs["DSP"], t, NS_(reason_code=st[2], comment=st[3], duplicate_of_ticket_id=None), at, w)
            elif kind == "cancel":
                workflow._do_cancel(db, ctxs[st[2]], t, NS_(reason=st[3]), at, w)
            t.version += 1
            t.updated_at = at
            db.flush()
        if n in DRAFTS:
            diag, photos = DRAFTS[n]
            r = draft_report(db, t.id)
            r.diagnosis = diag
            for stage, when in photos:
                add_photo(db, t, r, U[eng_of(t, U)], stage, T(when))
    # комментарии
    for n, who, vis, when, body in COMMENTS:
        t, at = tickets[n], T(when)
        c = Comment(ticket_id=t.id, author_id=U[who].id, body=body, visibility=vis, created_at=at)
        db.add(c)
        db.flush()
        workflow.add_event(db, t, "comment_added", at, actor=U[who], visibility=vis, payload={"comment_id": str(c.id)})
    # счётчик номеров и SLA-уведомления
    db.execute(text("INSERT INTO number_counters(year, last_value) VALUES (2026, 20) ON CONFLICT (year) DO UPDATE SET last_value = 20"))
    t4 = tickets[4]
    notifications.emit(db, "sla_breached", t4, T("03-12 03:00"), dedupe_key=f"sla_breach:{t4.id}:{t4.sla_resolution_limit_seconds}")
    jobs.check_sla(db, T0)
    for nt in db.scalars(select(Notification).where(Notification.created_at < T0 - timedelta(hours=24), Notification.read_at.is_(None))):
        nt.read_at = nt.created_at
    db.flush()
    return counts(db)


def eng_of(t: Ticket, U: dict) -> str:
    for k in ("ENG1", "ENG2"):
        if U[k].id == t.assigned_engineer_id:
            return k
    raise RuntimeError("нет исполнителя")


def current_act_id(db, t):
    from app.models import Act
    return db.scalar(select(Act.id).where(Act.ticket_id == t.id, Act.is_current.is_(True)))


def publish_tr_v2(db):
    v1 = db.scalar(select(ChecklistTemplate).where(ChecklistTemplate.code == "transformer_inspection", ChecklistTemplate.version == 1))
    v1.status, v1.retired_at = "retired", T("03-05 00:00")
    db.flush()
    db.add(ChecklistTemplate(code="transformer_inspection", version=2, equipment_type="transformer", title="Осмотр силового трансформатора",
                             schema={"items": TR_V2}, status="active", created_at=T("03-04 12:00"), published_at=T("03-05 00:00")))
    db.flush()


def add_photo(db, t, r, uploader, stage, at, label=None):
    data = placeholder_photo(label or f"{t.number} {stage}")
    info = process_upload(data, "photo", 10, 20)
    key = storage.new_key("attachments", info["ext"])
    storage.put(key, info["bytes"])
    tkey = storage.new_key("thumbs", "jpg")
    storage.put(tkey, info["thumb"])
    a = Attachment(ticket_id=t.id, work_report_id=r.id if r else None, kind="photo", stage=stage, visibility="public",
                   original_filename=f"{t.number}-{stage}.png", content_type=info["ctype"], size_bytes=len(info["bytes"]),
                   sha256=storage.sha256(info["bytes"]), width=info["w"], height=info["h"], storage_key=key,
                   thumb_storage_key=tkey, uploaded_by=uploader.id, uploaded_at=at)
    db.add(a)
    db.flush()
    workflow.add_event(db, t, "attachment_added", at, actor=uploader, payload={"attachment_id": str(a.id), "kind": "photo", "stage": stage})


def eq_doc(db, eq, uploader):
    data = placeholder_pdf("Паспорт изделия (демо)")
    key = storage.new_key("attachments", "pdf")
    storage.put(key, data)
    db.add(Attachment(equipment_id=eq.id, kind="document", visibility="public", original_filename="Паспорт изделия (демо).pdf",
                      content_type="application/pdf", size_bytes=len(data), sha256=storage.sha256(data), storage_key=key,
                      uploaded_by=uploader.id, uploaded_at=T("02-20 09:00")))


def fill_report(db, t, spec, U, at):
    r = draft_report(db, t.id)
    tpl = db.get(ChecklistTemplate, r.checklist_template_id)
    r.diagnosis, r.work_performed, r.result_code = spec["diag"], spec["work"], spec["res"]
    r.result_summary, r.recommendations, r.labor_minutes = spec["summary"], spec.get("recs"), spec["labor"]
    r.checklist_answers = default_answers(tpl.schema, spec.get("over"))
    r.parts_confirmed = True
    for u in db.scalars(select(PartUsage).where(PartUsage.work_report_id == r.id)):
        db.delete(u)
    db.flush()
    eng = U["ENG1"] if t.assigned_engineer_id == U["ENG1"].id else U["ENG2"]
    for sku, qty in spec["parts"]:
        sp = db.get(SparePart, uid("part", sku))
        db.add(PartUsage(ticket_id=t.id, work_report_id=r.id, spare_part_id=sp.id, quantity=qty, unit_snapshot=sp.unit,
                         added_by=eng.id, created_at=at - timedelta(hours=1), updated_at=at - timedelta(hours=1)))
    for stage, when in spec["photos"]:
        add_photo(db, t, r, eng, stage, T(when))
    db.flush()


def counts(db) -> dict:
    from app.models import Act, Assignment, TicketEvent
    out = {}
    for name, model in [("organizations", Organization), ("users", User), ("sites", Site), ("equipment", Equipment),
                        ("spare_parts", SparePart), ("checklist_templates", ChecklistTemplate), ("maintenance_plans", MaintenancePlan),
                        ("tickets", Ticket), ("ticket_events", TicketEvent), ("assignments", Assignment),
                        ("work_reports", WorkReport), ("part_usages", PartUsage), ("attachments", Attachment),
                        ("acts", Act), ("comments", Comment), ("notifications", Notification)]:
        out[name] = db.scalar(select(func.count()).select_from(model))
    return out
