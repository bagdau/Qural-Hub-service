import hashlib
import json
from datetime import datetime

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from . import pdf, storage
from .errors import ApiError
from .execution import checklist_rows
from .models import (Act, Attachment, ChecklistTemplate, Equipment, Organization, PartUsage, Site, SparePart, Ticket,
                     User, WorkReport)

TYPE_LABEL = {"transformer": "трансформатор", "substation": "подстанция (КТП)", "switchgear": "распределительное устройство"}
PRIO_LABEL = {"low": "низкий", "normal": "обычный", "high": "высокий", "critical": "критический"}
STAGE_LABEL = {"before": "до", "during": "в ходе работ", "after": "после", "other": "прочее"}
RESULT_LABEL = {"resolved": "Неисправность устранена", "resolved_with_remarks": "Устранено с замечаниями"}
STAGE_ORDER = {"before": 0, "after": 1, "during": 2, "other": 3}


def _iso(d: datetime | None):
    return d.isoformat().replace("+00:00", "Z") if d else None


def build_snapshot(db: DbSession, t: Ticket, r: WorkReport, version: int, number: str, now: datetime) -> dict:
    eq = db.get(Equipment, t.equipment_id)
    site = db.get(Site, t.site_id)
    client_org = db.get(Organization, t.organization_id)
    service_org = db.scalar(select(Organization).where(Organization.kind == "service"))
    engineer = db.get(User, r.author_id)
    tpl = db.get(ChecklistTemplate, r.checklist_template_id)
    parts = db.execute(select(PartUsage, SparePart).join(SparePart, SparePart.id == PartUsage.spare_part_id)
                       .where(PartUsage.work_report_id == r.id).order_by(SparePart.name)).all()
    photos = db.scalars(select(Attachment).where(
        Attachment.ticket_id == t.id, Attachment.kind == "photo", Attachment.deleted_at.is_(None))
        .order_by(Attachment.uploaded_at)).all()
    photos = sorted(photos, key=lambda a: (STAGE_ORDER.get(a.stage or "other", 3), a.uploaded_at))[:6]
    snap = {
        "act_number": number, "act_version": version, "layout_version": "act_v1", "generated_at": _iso(now),
        "timezone": site.timezone,
        "service_org": service_org.name if service_org else "",
        "client_org": client_org.name,
        "site": {"name": site.name, "address": site.address},
        "equipment": {"name": eq.name, "type_label": TYPE_LABEL[eq.type], "inventory_number": eq.inventory_number,
                      "serial_number": eq.serial_number, "manufacturer": eq.manufacturer, "model": eq.model},
        "ticket": {"number": t.number, "kind": t.kind, "priority_label": PRIO_LABEL[t.priority], "title": t.title,
                   "created_at": _iso(t.created_at), "started_at": _iso(t.started_at), "completed_at": _iso(now)},
        "engineer": engineer.full_name,
        "contact": " ".join(x for x in [t.contact_name, t.contact_phone] if x),
        "report": {"diagnosis": r.diagnosis, "work_performed": r.work_performed, "result_summary": r.result_summary,
                   "result_label": RESULT_LABEL.get(r.result_code, ""), "recommendations": r.recommendations,
                   "labor_minutes": r.labor_minutes,
                   "photo_exception": r.photo_exception_reason if r.photo_exception_status == "approved" else None},
        "template": {"code": tpl.code, "version": tpl.version, "title": tpl.title},
        "checklist": checklist_rows(tpl.schema, r.checklist_answers or {}),
        "parts": [{"name": s.name, "sku": s.sku, "quantity": float(u.quantity), "unit": u.unit_snapshot,
                   "serial_or_batch": u.serial_or_batch} for u, s in parts],
        "photos": [{"id": str(a.id), "stage_label": STAGE_LABEL.get(a.stage or "other", ""), "filename": a.original_filename,
                    "thumb": a.thumb_storage_key} for a in photos],
    }
    snap["data_hash"] = hashlib.sha256(json.dumps(jsonable_encoder(snap), sort_keys=True,
                                                  ensure_ascii=False).encode()).hexdigest()[:16]
    return snap


def generate(db: DbSession, t: Ticket, r: WorkReport, actor: User, now: datetime) -> tuple[Act, str]:
    """Формирует PDF, пишет файл в хранилище и добавляет запись акта. Возвращает (акт, storage_key)."""
    version = r.revision
    number = f"{t.number}-A{version}"
    snap = build_snapshot(db, t, r, version, number, now)
    images = {}
    for ph in snap["photos"]:
        if ph.get("thumb") and storage.exists(ph["thumb"]):
            images[ph["id"]] = storage.read(ph["thumb"])
    try:
        data = pdf.render_act(snap, images)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(500, "ACT_GENERATION_FAILED", "Не удалось сформировать акт. Повторите действие.") from exc
    key = storage.new_key("acts", "pdf")
    storage.put(key, data)
    act = Act(ticket_id=t.id, work_report_id=r.id, version=version, number=number, is_current=True,
              data_snapshot=jsonable_encoder(snap), storage_key=key, size_bytes=len(data), sha256=storage.sha256(data),
              generated_by=actor.id, generated_at=now)
    db.add(act)
    db.flush()
    return act, key
