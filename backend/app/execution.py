"""Отчёты о работах, чек-листы, условия завершения (5.5)."""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .errors import ApiError
from .models import Attachment, ChecklistTemplate, Equipment, PartUsage, Ticket, WorkReport


def active_template(db: DbSession, eq_type: str) -> ChecklistTemplate | None:
    return db.scalar(select(ChecklistTemplate).where(
        ChecklistTemplate.equipment_type == eq_type, ChecklistTemplate.status == "active"))


def current_report(db: DbSession, ticket_id, for_update=False) -> WorkReport | None:
    q = select(WorkReport).where(WorkReport.ticket_id == ticket_id).order_by(WorkReport.revision.desc()).limit(1)
    if for_update:
        q = q.with_for_update()
    return db.scalar(q)


def draft_report(db: DbSession, ticket_id, for_update=False) -> WorkReport | None:
    q = select(WorkReport).where(WorkReport.ticket_id == ticket_id, WorkReport.status == "draft")
    if for_update:
        q = q.with_for_update()
    return db.scalar(q)


def ensure_draft(db: DbSession, t: Ticket, engineer_id, now: datetime) -> WorkReport:
    d = draft_report(db, t.id)
    if d:
        return d
    last = current_report(db, t.id)
    if last is not None:
        return clone_report(db, t, last, engineer_id, now)
    eq = db.get(Equipment, t.equipment_id)
    tpl = active_template(db, eq.type)
    if tpl is None:
        raise ApiError(422, "NO_CHECKLIST_TEMPLATE", "Для этого типа оборудования нет активного шаблона чек-листа.")
    r = WorkReport(ticket_id=t.id, revision=1, status="draft", author_id=engineer_id,
                   checklist_template_id=tpl.id, created_at=now, updated_at=now)
    db.add(r)
    db.flush()
    return r


def clone_report(db: DbSession, t: Ticket, src: WorkReport, engineer_id, now: datetime) -> WorkReport:
    r = WorkReport(
        ticket_id=t.id, revision=src.revision + 1, status="draft", author_id=engineer_id,
        checklist_template_id=src.checklist_template_id, checklist_answers=dict(src.checklist_answers or {}),
        diagnosis=src.diagnosis, work_performed=src.work_performed, result_code=src.result_code,
        result_summary=src.result_summary, recommendations=src.recommendations, labor_minutes=src.labor_minutes,
        parts_confirmed=src.parts_confirmed, created_at=now, updated_at=now)
    db.add(r)
    db.flush()
    for u in db.scalars(select(PartUsage).where(PartUsage.work_report_id == src.id)):
        db.add(PartUsage(ticket_id=t.id, work_report_id=r.id, spare_part_id=u.spare_part_id, quantity=u.quantity,
                         unit_snapshot=u.unit_snapshot, serial_or_batch=u.serial_or_batch, comment=u.comment,
                         added_by=u.added_by, created_at=now, updated_at=now))
    return r


def _value(ans):
    return ans.get("value") if isinstance(ans, dict) else ans


def is_flagged(item: dict, value) -> bool:
    if value is None:
        return False
    cond = item.get("flag_if")
    if cond:
        if "equals" in cond and value == cond["equals"]:
            return True
        try:
            if "gt" in cond and float(value) > cond["gt"]:
                return True
            if "lt" in cond and float(value) < cond["lt"]:
                return True
        except (TypeError, ValueError):
            pass
        if "in" in cond and value in cond["in"]:
            return True
    if item.get("type") == "enum":
        for o in item.get("options", []):
            if o.get("value") == value and o.get("flag"):
                return True
    return False


def validate_answers(schema: dict, answers: dict, final: bool = False) -> dict[str, str]:
    errors: dict[str, str] = {}
    items = {i["key"]: i for i in schema.get("items", [])}
    for k in answers:
        if k not in items:
            errors[k] = "Неизвестный пункт чек-листа."
    for key, item in items.items():
        ans = answers.get(key)
        v = _value(ans)
        typ = item["type"]
        if v is not None and v != "":
            if typ == "boolean" and not isinstance(v, bool):
                errors[key] = "Ожидается значение «Да/Нет»."
            elif typ == "number":
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    errors[key] = "Ожидается число."
                else:
                    if "min" in item and v < item["min"] or "max" in item and v > item["max"]:
                        errors[key] = f"Значение вне диапазона {item.get('min')}…{item.get('max')}."
            elif typ == "enum":
                if v not in [o["value"] for o in item.get("options", [])]:
                    errors[key] = "Недопустимое значение."
            elif typ == "text":
                if not isinstance(v, str) or len(v) > 2000:
                    errors[key] = "Текст не длиннее 2000 символов."
        if final and key not in errors:
            if item.get("required") and (v is None or v == ""):
                errors[key] = "Обязательный пункт."
            elif is_flagged(item, v) and not (isinstance(ans, dict) and (ans.get("comment") or "").strip()):
                errors[key] = "Для значения «не норма» нужен комментарий."
    return errors


def checklist_rows(schema: dict, answers: dict) -> list[dict]:
    rows = []
    for item in schema.get("items", []):
        ans = answers.get(item["key"])
        v = _value(ans)
        shown = v
        if item["type"] == "boolean" and isinstance(v, bool):
            shown = "Да" if v else "Нет"
        elif item["type"] == "enum":
            for o in item.get("options", []):
                if o["value"] == v:
                    shown = o["label"]
        rows.append({"section": item.get("section", ""), "label": item["label"], "value": shown,
                     "unit": item.get("unit"), "flagged": is_flagged(item, v),
                     "comment": ans.get("comment") if isinstance(ans, dict) else None})
    return rows


def photo_counts(db: DbSession, ticket_id) -> dict:
    rows = db.execute(select(Attachment.stage, func.count()).where(
        Attachment.ticket_id == ticket_id, Attachment.kind == "photo", Attachment.deleted_at.is_(None)
    ).group_by(Attachment.stage)).all()
    return {s: n for s, n in rows}


def completion_check(db: DbSession, t: Ticket, r: WorkReport | None) -> list[dict]:
    failed = []
    if r is None:
        return [{"code": "NO_REPORT", "message": "Отчёт не начат."}]
    if len((r.diagnosis or "").strip()) < 20:
        failed.append({"code": "DIAGNOSIS_MISSING", "message": "Опишите диагностику (не менее 20 символов)."})
    w_ok = len((r.work_performed or "").strip()) >= 20 and r.result_code in ("resolved", "resolved_with_remarks") \
        and len((r.result_summary or "").strip()) >= 10
    if r.result_code == "resolved_with_remarks" and len((r.recommendations or "").strip()) < 10:
        w_ok = False
    if not w_ok:
        failed.append({"code": "WORK_RESULT_MISSING",
                       "message": "Заполните выполненные работы (≥20), результат и итог (≥10); "
                                  "при «с замечаниями» — рекомендации (≥10)."})
    tpl = _template(db, r)
    errs = validate_answers(tpl.schema, r.checklist_answers or {}, final=True) if tpl else {}
    if errs:
        failed.append({"code": "CHECKLIST_INCOMPLETE", "message": "Не заполнены или некорректны пункты чек-листа.",
                       "keys": sorted(errs.keys())})
    pc = photo_counts(db, t.id)
    if not ((pc.get("before", 0) >= 1 and pc.get("after", 0) >= 1) or r.photo_exception_status == "approved"):
        failed.append({"code": "PHOTOS_MISSING",
                       "message": "Добавьте фото «до» и «после» или получите согласованное исключение у диспетчера."})
    if not r.parts_confirmed:
        failed.append({"code": "PARTS_NOT_CONFIRMED",
                       "message": "Подтвердите список запчастей (или отметьте, что запчасти не использовались)."})
    return failed


def _template(db: DbSession, r: WorkReport) -> ChecklistTemplate:
    return db.get(ChecklistTemplate, r.checklist_template_id)


def work_stage(r: WorkReport | None) -> str | None:
    if r is None or r.status != "draft":
        return None
    if len((r.diagnosis or "").strip()) < 20:
        return "diagnostics"
    if len((r.work_performed or "").strip()) < 20:
        return "repair"
    return "ready"
