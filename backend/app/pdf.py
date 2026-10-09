"""Генерация PDF-акта (макет act_v1) на ReportLab. Шрифты с кириллицей и казахскими буквами."""
import io
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
]
_registered = False
FONT, FONT_B = "ActFont", "ActFont-Bold"


def _register():
    global _registered
    if _registered:
        return
    env = os.environ.get("ACT_FONT_PATH")
    cands = ([(env, env.replace(".ttf", "-Bold.ttf"))] if env else []) + _FONT_CANDIDATES
    for reg, bold in cands:
        if os.path.exists(reg):
            pdfmetrics.registerFont(TTFont(FONT, reg))
            pdfmetrics.registerFont(TTFont(FONT_B, bold if os.path.exists(bold) else reg))
            _registered = True
            return
    raise RuntimeError("Не найден шрифт для PDF (DejaVuSans). Установите fonts-dejavu-core.")


def _dt(s: str | None, tz: str) -> str:
    if not s:
        return "—"
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    try:
        loc = d.astimezone(ZoneInfo(tz))
    except Exception:
        loc = d
    return f"{loc:%d.%m.%Y %H:%M} ({tz}) / {d:%H:%M} UTC"


def render_act(snap: dict, images: dict[str, bytes]) -> bytes:
    _register()
    tz = snap.get("timezone", "Asia/Almaty")
    base = ParagraphStyle("b", fontName=FONT, fontSize=9.5, leading=13)
    small = ParagraphStyle("s", parent=base, fontSize=8, textColor=colors.HexColor("#475467"), leading=10)
    h1 = ParagraphStyle("h1", parent=base, fontName=FONT_B, fontSize=16, leading=20, textColor=colors.HexColor("#0A1A33"))
    h2 = ParagraphStyle("h2", parent=base, fontName=FONT_B, fontSize=11, leading=14,
                        textColor=colors.HexColor("#0F766E"), spaceBefore=8, spaceAfter=3)
    P = lambda t, st=base: Paragraph(escape(str(t)).replace("\n", "<br/>"), st)  # noqa: E731

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm,
                            bottomMargin=16 * mm, title=f"Акт {snap['act_number']}", author="Alageum Service Hub")
    t, eq, rep = snap["ticket"], snap["equipment"], snap["report"]
    story = [P("Акт выполненных работ", h1), P(f"№ {snap['act_number']} · версия {snap['act_version']}", base),
             P(f"Сформирован: {_dt(snap['generated_at'], tz)}", small), Spacer(1, 6)]

    def kv(rows):
        data = [[P(k, small), P(v)] for k, v in rows]
        tb = Table(data, colWidths=[42 * mm, 134 * mm])
        tb.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#D0D5DD")),
                                ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        return tb

    story += [P("Стороны и объект", h2), kv([
        ("Исполнитель (сервис)", snap["service_org"]), ("Заказчик", snap["client_org"]),
        ("Площадка", f"{snap['site']['name']}, {snap['site']['address']}"),
        ("Оборудование", f"{eq['name']} ({eq['type_label']})"),
        ("Инв. / серийный №", f"{eq['inventory_number']} / {eq.get('serial_number') or '—'}"),
        ("Производитель / модель", f"{eq.get('manufacturer') or '—'} / {eq.get('model') or '—'}"),
    ])]
    story += [P("Заявка", h2), kv([
        ("Номер", f"{t['number']} ({'плановая' if t['kind'] == 'planned' else 'корректирующая'}, приоритет: {t['priority_label']})"),
        ("Тема", t["title"]), ("Создана", _dt(t["created_at"], tz)), ("Начало работ", _dt(t.get("started_at"), tz)),
        ("Завершение работ", _dt(t.get("completed_at"), tz)), ("Инженер", snap["engineer"]),
        ("Контакт заказчика", snap.get("contact") or "—"),
    ])]
    story += [P("Диагностика", h2), P(rep.get("diagnosis") or "—"), P("Выполненные работы", h2),
              P(rep.get("work_performed") or "—"), P("Результат", h2),
              P(f"{rep['result_label']}. {rep.get('result_summary') or ''}")]
    if rep.get("recommendations"):
        story += [P("Рекомендации", h2), P(rep["recommendations"])]
    if rep.get("labor_minutes") is not None:
        story += [P(f"Трудозатраты: {rep['labor_minutes']} мин.", small)]

    rows = snap.get("checklist", [])
    if rows:
        story += [P(f"Чек-лист: {snap['template']['title']} (версия {snap['template']['version']})", h2)]
        data = [[P("Пункт", small), P("Значение", small), P("Комментарий", small)]]
        for r in rows:
            val = "—" if r["value"] is None else f"{r['value']}{(' ' + r['unit']) if r.get('unit') else ''}"
            if r["flagged"]:
                val += "  (НЕ НОРМА)"
            data.append([P(r["label"]), P(val), P(r.get("comment") or "")])
        tb = Table(data, colWidths=[78 * mm, 38 * mm, 60 * mm], repeatRows=1)
        tb.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D0D5DD")),
                                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF2FB")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(tb)

    story.append(P("Использованные запчасти", h2))
    if snap["parts"]:
        data = [[P("Наименование", small), P("Артикул", small), P("Кол-во", small), P("Партия/сер. №", small)]]
        for p in snap["parts"]:
            data.append([P(p["name"]), P(p["sku"]), P(f"{p['quantity']} {p['unit']}"), P(p.get("serial_or_batch") or "")])
        tb = Table(data, colWidths=[70 * mm, 30 * mm, 28 * mm, 48 * mm])
        tb.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D0D5DD")),
                                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF2FB"))]))
        story.append(tb)
    else:
        story.append(P("Запчасти не использовались."))

    story.append(P("Фотографии", h2))
    imgs = []
    for ph in snap["photos"]:
        data = images.get(ph["id"])
        if data:
            im = Image(io.BytesIO(data), width=52 * mm, height=39 * mm, kind="proportional")
            imgs.append([im, P(f"{ph['stage_label']}: {ph['filename']}", small)])
    if imgs:
        cells = [[Table([[c[0]], [c[1]]], colWidths=[56 * mm]) for c in imgs[i:i + 3]] for i in range(0, len(imgs), 3)]
        for row in cells:
            while len(row) < 3:
                row.append("")
        story.append(Table(cells, colWidths=[58 * mm] * 3))
    elif rep.get("photo_exception"):
        story.append(P(f"Фотографии не прилагаются (согласованное исключение): {rep['photo_exception']}"))
    else:
        story.append(P("—"))

    story += [Spacer(1, 8), P("Подтверждение клиента", h2),
              P("Статус на момент формирования акта: ожидает подтверждения в информационной системе."),
              P("Подтверждение в информационной системе фиксирует решение пользователя (кто, когда, какая версия акта) "
                "и не является квалифицированной электронной подписью.", small), Spacer(1, 6),
              P(f"Версия акта: {snap['act_version']} · макет {snap['layout_version']} · "
                f"контрольная сумма данных: {snap['data_hash']}", small)]
    doc.build(story)
    return buf.getvalue()


def render_confirmation(info: dict) -> bytes:
    _register()
    base = ParagraphStyle("b", fontName=FONT, fontSize=10, leading=14)
    h1 = ParagraphStyle("h1", parent=base, fontName=FONT_B, fontSize=15, leading=19)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm)
    st = [Paragraph("Лист подтверждения акта", h1), Spacer(1, 8)]
    for k, v in info.items():
        st.append(Paragraph(f"<b>{escape(k)}:</b> {escape(str(v))}", base))
    st += [Spacer(1, 10), Paragraph("Подтверждение в информационной системе не является квалифицированной "
                                    "электронной подписью.", base)]
    doc.build(st)
    return buf.getvalue()
