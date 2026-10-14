"""Генератор документов (отдельный модуль): QR-этикетки в нескольких форматах и паспорт оборудования (PDF)."""
import io
from dataclasses import dataclass

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .. import pdf
from ..errors import field_error
from . import qr


@dataclass(frozen=True)
class Layout:
    id: str
    title: str
    page: tuple[float, float]          # размер страницы, pt
    cols: int
    rows: int
    qr_mm: float                       # сторона QR, мм
    compact: bool = False


LAYOUTS: dict[str, Layout] = {
    "sheet8": Layout("sheet8", "Лист A4: 8 этикеток (2×4)", A4, 2, 4, 38),
    "label100x70": Layout("label100x70", "Одна этикетка 100×70 мм", (100 * mm, 70 * mm), 1, 1, 42),
    "sticker50x30": Layout("sticker50x30", "Наклейка 50×30 мм", (50 * mm, 30 * mm), 1, 1, 24, compact=True),
}


def layout(layout_id: str) -> Layout:
    if layout_id not in LAYOUTS:
        raise field_error("layout", "invalid", "Формат: " + ", ".join(LAYOUTS))
    return LAYOUTS[layout_id]


def _wrap(text: str, n: int) -> list[str]:
    words, lines, cur = (text or "").split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > n and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    return lines + ([cur] if cur else [])


FOOT_TEXT = "При неисправностях отсканируйте QR-код и создайте заявку"
NAVY, TEAL = colors.HexColor("#0f172a"), colors.HexColor("#0d7a5f")


def _draw_compact(c: canvas.Canvas, x: float, y: float, w: float, h: float, item: dict, lay: Layout) -> None:
    pad = 2 * mm
    q = lay.qr_mm * mm
    c.drawImage(ImageReader(io.BytesIO(qr.png(item["url"], scale=12, border=4, ec="m"))), x + pad, y + (h - q) / 2, q, q)
    tx = x + pad + q + 3 * mm
    ty = y + h - pad - 3 * mm
    c.setFillColor(colors.black)
    c.setFont(pdf.FONT_B, 8)
    c.drawString(tx, ty, item["inventory"])
    c.setFont(pdf.FONT, 6.5)
    cur = ty - 3 * mm
    for line in _wrap(item["name"], 14)[:2]:
        c.drawString(tx, cur, line)
        cur -= 3 * mm
    c.setFont(pdf.FONT, 5.5)
    c.drawString(tx, y + pad, item["code"])


def _draw_label(c: canvas.Canvas, x: float, y: float, w: float, h: float, item: dict, lay: Layout) -> None:
    """Этикетка: шапка «ОБОРУДОВАНИЕ» → QR и данные → подвал «При неисправностях отсканируйте…»."""
    if lay.compact:
        return _draw_compact(c, x, y, w, h, item, lay)
    head, foot = 8 * mm, 9 * mm
    c.setStrokeColor(NAVY)
    c.setLineWidth(1)
    c.rect(x, y, w, h)
    c.setFillColor(NAVY)
    c.rect(x, y + h - head, w, head, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(pdf.FONT_B, 10)
    c.drawString(x + 4 * mm, y + h - head + 2.6 * mm, "ОБОРУДОВАНИЕ")
    c.setFont(pdf.FONT, 7)
    c.drawRightString(x + w - 4 * mm, y + h - head + 2.8 * mm, "Alageum Service Hub")
    c.setFillColor(TEAL)
    c.rect(x, y, w, foot, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(pdf.FONT_B, 7.5)
    lines = [FOOT_TEXT] if c.stringWidth(FOOT_TEXT, pdf.FONT_B, 7.5) < w - 6 * mm else ["При неисправностях отсканируйте", "QR-код и создайте заявку"]
    for i, line in enumerate(lines):
        c.drawCentredString(x + w / 2, y + foot / 2 + (1.2 if len(lines) == 1 else 1.6 - 3.2 * i) * mm - 1, line)
    body_h = h - head - foot
    q = min(lay.qr_mm * mm, body_h - 4 * mm)
    pad = 4 * mm
    c.drawImage(ImageReader(io.BytesIO(qr.png(item["url"], scale=12, border=4, ec="q"))), x + pad, y + foot + (body_h - q) / 2, q, q)
    tx = x + pad + q + 3 * mm
    width_chars = max(12, int((x + w - 3 * mm - tx) / (1.75 * mm)))
    ty = y + h - head - 6 * mm
    c.setFillColor(colors.black)
    c.setFont(pdf.FONT_B, 12)
    c.drawString(tx, ty, item["inventory"])
    c.setFont(pdf.FONT, 9)
    step = 4.4 * mm
    cur = ty - step
    for line in _wrap(item["name"], width_chars)[:3]:
        c.drawString(tx, cur, line)
        cur -= step
    c.setFillColor(colors.HexColor("#475467"))
    for line in _wrap(item.get("site") or "", width_chars)[:2]:
        c.drawString(tx, cur, line)
        cur -= step
    c.setFont(pdf.FONT, 7)
    c.drawString(tx, y + foot + 2.5 * mm, f"Код: {item['code']}")


def qr_labels(items: list[dict], layout_id: str = "sheet8") -> bytes:
    """items: {code, url, inventory, name, site}"""
    pdf._register()
    lay = layout(layout_id)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=lay.page)
    c.setTitle("QR-этикетки оборудования")
    c.setAuthor("Alageum Service Hub")
    W, H = lay.page
    per_page = lay.cols * lay.rows
    cw, ch = W / lay.cols, H / lay.rows
    for i, item in enumerate(items):
        if i and i % per_page == 0:
            c.showPage()
        col, row = (i % per_page) % lay.cols, (i % per_page) // lay.cols
        x0, y0 = col * cw, H - (row + 1) * ch
        inset = 4 * mm if lay.id == "sheet8" else 1 * mm if not lay.compact else 0
        _draw_label(c, x0 + inset, y0 + inset, cw - 2 * inset, ch - 2 * inset, item, lay)
    c.save()
    return buf.getvalue()


def equipment_passport(d: dict, history: list[dict], url: str) -> bytes:
    """Паспорт оборудования (A4): характеристики, QR, плановые даты, последние обслуживания."""
    pdf._register()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Паспорт оборудования {d['inventory_number']}")
    c.setAuthor("Alageum Service Hub")
    W, H = A4
    m = 18 * mm
    y = H - m
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont(pdf.FONT_B, 16)
    c.drawString(m, y, "Цифровой паспорт оборудования")
    c.setFont(pdf.FONT, 9)
    c.setFillColor(colors.HexColor("#475467"))
    c.drawString(m, y - 6 * mm, f"{d['organization']['name']} · {d['site']['name']}, {d['site']['address']}")
    q = 42 * mm
    c.drawImage(ImageReader(io.BytesIO(qr.png(url, scale=12, border=4, ec="q"))), W - m - q, y - q + 4 * mm, q, q)
    c.setFont(pdf.FONT, 7)
    c.drawString(W - m - q, y - q, f"Код: {d['qr_code']}")
    y -= 18 * mm
    c.setFillColor(colors.black)
    c.setFont(pdf.FONT_B, 13)
    c.drawString(m, y, d["name"])
    y -= 8 * mm
    rows = [
        ("Тип", d["type_label"]), ("Инвентарный №", d["inventory_number"]), ("Серийный №", d.get("serial_number") or "—"),
        ("Производитель / модель", f"{d.get('manufacturer') or '—'} / {d.get('model') or '—'}"),
        ("Год выпуска", d.get("manufacture_year") or "—"),
        ("Мощность / напряжение", f"{d.get('rated_power_kva') or '—'} кВА / {d.get('voltage_class_kv') or '—'} кВ"),
        ("Состояние", d.get("state_label") or ""), ("Место установки", d.get("location_description") or "—"),
        ("Ближайшее ТО", d.get("next_due_date") or "—"), ("Последнее ТО", d.get("last_done_on") or "—"),
    ]
    c.setFont(pdf.FONT, 9.5)
    for k, v in rows:
        c.setFillColor(colors.HexColor("#475467"))
        c.drawString(m, y, k)
        c.setFillColor(colors.black)
        c.drawString(m + 52 * mm, y, str(v))
        y -= 5.6 * mm
    y -= 6 * mm
    c.setFillColor(colors.HexColor("#0d7a5f"))
    c.setFont(pdf.FONT_B, 11)
    c.drawString(m, y, "История обслуживания (последние записи)")
    y -= 6 * mm
    c.setFont(pdf.FONT, 8.5)
    if not history:
        c.setFillColor(colors.HexColor("#475467"))
        c.drawString(m, y, "Заявок по оборудованию ещё не было.")
    for h in history[:14]:
        if y < 22 * mm:
            c.showPage()
            y = H - m
            c.setFont(pdf.FONT, 8.5)
        c.setFillColor(colors.black)
        c.drawString(m, y, f"{h['number']}  {h['date']}  {h['kind']}  {h['status']}")
        y -= 4.4 * mm
        text = h.get("diagnosis") or h.get("title") or ""
        c.setFillColor(colors.HexColor("#475467"))
        for line in _wrap(text, 110)[:2]:
            c.drawString(m + 4 * mm, y, line)
            y -= 4 * mm
        y -= 1.6 * mm
    c.setFont(pdf.FONT, 7)
    c.setFillColor(colors.HexColor("#475467"))
    c.drawString(m, 12 * mm, f"Сформировано системой Alageum Service Hub · {url}")
    c.save()
    return buf.getvalue()
