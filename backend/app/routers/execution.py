import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import clock, idempotency, notifications
from ..db import get_db
from ..errors import ApiError, conflict, field_error, not_found
from ..execution import (completion_check, current_report, draft_report, validate_answers)
from ..models import ChecklistTemplate, PartUsage, SparePart, Ticket, WorkReport
from ..schemas import (PartIn, PartPatch, PhotoExceptionDecision, PhotoExceptionIn, ReportPut, SparePartIn,
                       SparePartPatch, TemplateIn, TemplatePatch)
from ..security import Ctx, audit, get_ctx, require
from ..serializers import page_of
from ..visibility import get_ticket
from ..workflow import add_event
from .common import Page, paginate, strict_params, version_check
from fastapi import Query

router = APIRouter(tags=["execution"])


def _uuid(x):
    try:
        return uuid.UUID(str(x))
    except ValueError:
        raise not_found()


def tpl_out(t: ChecklistTemplate, full: bool = True) -> dict:
    d = {"id": t.id, "code": t.code, "version": t.version, "equipment_type": t.equipment_type, "title": t.title,
         "status": t.status, "published_at": t.published_at}
    if full:
        d["schema"] = t.schema
    return d


def report_out(db: DbSession, r: WorkReport, t: Ticket, ctx: Ctx, with_check: bool = True) -> dict:
    tpl = db.get(ChecklistTemplate, r.checklist_template_id)
    parts = [{"id": u.id, "spare_part_id": s.id, "name": s.name, "sku": s.sku, "quantity": float(u.quantity),
              "unit": u.unit_snapshot, "serial_or_batch": u.serial_or_batch, "comment": u.comment}
             for u, s in db.execute(select(PartUsage, SparePart).join(SparePart, SparePart.id == PartUsage.spare_part_id)
                                    .where(PartUsage.work_report_id == r.id).order_by(SparePart.name))]
    d = {"id": r.id, "ticket_id": r.ticket_id, "revision": r.revision, "status": r.status, "author_id": r.author_id,
         "template": tpl_out(tpl), "checklist_answers": r.checklist_answers, "diagnosis": r.diagnosis,
         "work_performed": r.work_performed, "result_code": r.result_code, "result_summary": r.result_summary,
         "recommendations": r.recommendations, "labor_minutes": r.labor_minutes, "parts_confirmed": r.parts_confirmed,
         "photo_exception": {"status": r.photo_exception_status, "reason": r.photo_exception_reason,
                             "comment": r.photo_exception_comment},
         "parts": parts, "submitted_at": r.submitted_at, "version": r.version, "updated_at": r.updated_at}
    if with_check and r.status == "draft":
        failed = completion_check(db, t, r)
        d["completion_check"] = {"ok": not failed, "failed_checks": failed}
    return d


def _report_for_view(db, ctx, t, revision=None):
    if revision:
        r = db.scalar(select(WorkReport).where(WorkReport.ticket_id == t.id, WorkReport.revision == revision))
    else:
        r = current_report(db, t.id)
    if not r:
        raise not_found("Отчёт по заявке ещё не начат.")
    return r


@router.get("/tickets/{ticket_id}/report")
def get_report(ticket_id: str, revision: int | None = None, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    if ctx.role == "client":
        raise ApiError(403, "FORBIDDEN", "Отчёт доступен клиенту в составе акта.")
    t = get_ticket(db, ctx, _uuid(ticket_id))
    return report_out(db, _report_for_view(db, ctx, t, revision), t, ctx)


def _own_draft(db, ctx, ticket_id, lock=True):
    t = get_ticket(db, ctx, _uuid(ticket_id), for_update=lock)
    if ctx.role != "engineer" or t.assigned_engineer_id != ctx.user.id:
        raise ApiError(403, "FORBIDDEN", "Отчёт может редактировать только назначенный инженер.")
    r = draft_report(db, t.id, for_update=lock)
    if not r:
        raise conflict("REPORT_LOCKED", "Нет черновика отчёта: работа не начата или отчёт уже отправлен.")
    return t, r


@router.put("/tickets/{ticket_id}/report")
def put_report(ticket_id: str, body: ReportPut, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    t, r = _own_draft(db, ctx, ticket_id)
    if t.status not in ("in_progress", "paused", "assigned"):
        raise conflict("REPORT_LOCKED", "Отчёт нельзя редактировать в текущем статусе заявки.")
    version_check(r, body.version, "Отчёт")
    data = body.model_dump(exclude_unset=True, exclude={"version"})
    if "checklist_answers" in data and data["checklist_answers"] is not None:
        tpl = db.get(ChecklistTemplate, r.checklist_template_id)
        errs = validate_answers(tpl.schema, data["checklist_answers"], final=False)
        if errs:
            raise ApiError(422, "VALIDATION_ERROR", "Проверьте заполнение чек-листа.",
                           {"fields": [{"field": f"checklist_answers.{k}", "code": "invalid", "message": m} for k, m in errs.items()]})
    for k, v in data.items():
        setattr(r, k, v)
    r.version += 1
    r.updated_at = clock.now()
    db.flush()
    return report_out(db, r, t, ctx)


@router.get("/tickets/{ticket_id}/report/completion-check")
def check(ticket_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    if ctx.role == "client":
        raise ApiError(403, "FORBIDDEN", "Недостаточно прав.")
    r = draft_report(db, t.id)
    failed = completion_check(db, t, r)
    return {"ok": not failed, "failed_checks": failed}


@router.post("/tickets/{ticket_id}/photo-exception")
def photo_exception(ticket_id: str, body: PhotoExceptionIn, request: Request, ctx: Ctx = Depends(get_ctx),
                    db: DbSession = Depends(get_db, scope="function")):
    tid = ticket_id

    def go():
        t, r = _own_draft(db, ctx, tid)
        version_check(r, body.version, "Отчёт")
        if r.photo_exception_status == "requested":
            raise conflict("INVALID_TRANSITION", "Запрос исключения уже отправлен.")
        now = clock.now()
        r.photo_exception_status, r.photo_exception_reason = "requested", body.reason
        r.photo_exception_decided_by = r.photo_exception_decided_at = r.photo_exception_comment = None
        r.version += 1
        r.updated_at = now
        add_event(db, t, "photo_exception_requested", now, actor=ctx.user, request_id=ctx.request_id,
                  visibility="internal", comment=body.reason)
        notifications.emit(db, "photo_exception_requested", t, now, actor_id=ctx.user.id)
        return 200, report_out(db, r, t, ctx)
    return idempotency.run(db, ctx, request, {"id": tid, **body.model_dump()}, go)


@router.post("/tickets/{ticket_id}/photo-exception/decision")
def photo_exception_decision(ticket_id: str, body: PhotoExceptionDecision, ctx: Ctx = Depends(require("dispatcher")),
                             db: DbSession = Depends(get_db, scope="function")):
    t = get_ticket(db, ctx, _uuid(ticket_id), for_update=True)
    r = draft_report(db, t.id, for_update=True)
    if not r or r.photo_exception_status != "requested":
        raise conflict("INVALID_TRANSITION", "Нет запроса на исключение по фото.")
    version_check(r, body.version, "Отчёт")
    now = clock.now()
    r.photo_exception_status = body.decision
    r.photo_exception_decided_by, r.photo_exception_decided_at, r.photo_exception_comment = ctx.user.id, now, body.comment
    r.version += 1
    r.updated_at = now
    add_event(db, t, f"photo_exception_{body.decision}", now, actor=ctx.user, request_id=ctx.request_id,
              visibility="internal", comment=body.comment)
    notifications.emit(db, "photo_exception_decided", t, now, actor_id=ctx.user.id, body=f"Решение: {body.decision}")
    return report_out(db, r, t, ctx)


# ---------------- запчасти в отчёте ----------------
@router.get("/tickets/{ticket_id}/parts")
def ticket_parts(ticket_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    r = current_report(db, t.id)
    if not r:
        return []
    if ctx.role == "client" and r.status != "submitted":
        return []
    return report_out(db, r, t, ctx, with_check=False)["parts"]


@router.post("/tickets/{ticket_id}/parts", status_code=201)
def add_part(ticket_id: str, body: PartIn, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    t, r = _own_draft(db, ctx, ticket_id)
    sp = db.get(SparePart, body.spare_part_id)
    if not sp or not sp.is_active:
        raise field_error("spare_part_id", "inactive", "Позиция справочника недоступна.")
    if sp.unit in ("pcs", "set") and body.quantity != int(body.quantity):
        raise field_error("quantity", "integer", "Для штучных позиций количество должно быть целым.")
    if db.scalar(select(PartUsage.id).where(PartUsage.work_report_id == r.id, PartUsage.spare_part_id == sp.id)):
        raise conflict("DUPLICATE", "Эта позиция уже добавлена — измените количество.")
    now = clock.now()
    u = PartUsage(ticket_id=t.id, work_report_id=r.id, spare_part_id=sp.id, quantity=body.quantity, unit_snapshot=sp.unit,
                  serial_or_batch=body.serial_or_batch, comment=body.comment, added_by=ctx.user.id, created_at=now, updated_at=now)
    db.add(u)
    db.flush()
    return {"id": u.id, "spare_part_id": sp.id, "name": sp.name, "sku": sp.sku, "quantity": float(u.quantity), "unit": sp.unit}


def _usage(db, ctx, ticket_id, usage_id):
    t, r = _own_draft(db, ctx, ticket_id)
    u = db.get(PartUsage, _uuid(usage_id))
    if not u or u.work_report_id != r.id:
        raise not_found()
    return t, r, u


@router.patch("/tickets/{ticket_id}/parts/{usage_id}")
def patch_part(ticket_id: str, usage_id: str, body: PartPatch, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    t, r, u = _usage(db, ctx, ticket_id, usage_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(u, k, v)
    u.updated_at = clock.now()
    return {"id": u.id, "quantity": float(u.quantity)}


@router.delete("/tickets/{ticket_id}/parts/{usage_id}", status_code=204)
def del_part(ticket_id: str, usage_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    from fastapi import Response
    t, r, u = _usage(db, ctx, ticket_id, usage_id)
    db.delete(u)
    return Response(status_code=204)


# ---------------- справочник запчастей ----------------
def part_out(p: SparePart) -> dict:
    return {"id": p.id, "sku": p.sku, "name": p.name, "unit": p.unit, "category": p.category,
            "description": p.description, "is_active": p.is_active, "version": p.version}


@router.get("/spare-parts")
def list_parts(request: Request, q: str | None = None, category: str | None = None, is_active: bool | None = None,
               pg: Page = Depends(), ctx: Ctx = Depends(require("admin", "dispatcher", "manager", "engineer")),
               db: DbSession = Depends(get_db, scope="function")):
    strict_params(request, {"q", "category", "is_active"})
    qy = select(SparePart)
    if q:
        qy = qy.where(SparePart.name.ilike(f"%{q}%") | SparePart.sku.ilike(f"%{q}%"))
    if category:
        qy = qy.where(SparePart.category == category)
    if is_active is not None:
        qy = qy.where(SparePart.is_active == is_active)
    elif ctx.role == "engineer":
        qy = qy.where(SparePart.is_active.is_(True))
    qy = qy.order_by(SparePart.name, SparePart.id)
    rows, total = paginate(db, qy, pg)
    return page_of([part_out(p) for p in rows], total, pg.page, pg.page_size)


@router.post("/spare-parts", status_code=201)
def create_part(body: SparePartIn, ctx: Ctx = Depends(require("admin", "dispatcher")), db: DbSession = Depends(get_db, scope="function")):
    from sqlalchemy import func
    if db.scalar(select(SparePart.id).where(func.lower(SparePart.sku) == body.sku.lower())):
        raise conflict("DUPLICATE", "Позиция с таким артикулом уже существует.")
    now = clock.now()
    p = SparePart(created_at=now, updated_at=now, **body.model_dump())
    db.add(p)
    db.flush()
    return part_out(p)


@router.patch("/spare-parts/{part_id}")
def patch_spare(part_id: str, body: SparePartPatch, ctx: Ctx = Depends(require("admin", "dispatcher")), db: DbSession = Depends(get_db, scope="function")):
    p = db.scalar(select(SparePart).where(SparePart.id == _uuid(part_id)).with_for_update())
    if not p:
        raise not_found()
    version_check(p, body.version, "Позиция")
    for k, v in body.model_dump(exclude_unset=True, exclude={"version"}).items():
        setattr(p, k, v)
    p.version += 1
    p.updated_at = clock.now()
    return part_out(p)


# ---------------- шаблоны чек-листов ----------------
def _validate_schema(schema: dict):
    items = schema.get("items")
    if not isinstance(items, list) or not items:
        raise field_error("schema", "invalid", "Шаблон должен содержать список пунктов items.")
    keys = set()
    for i in items:
        if not all(k in i for k in ("key", "label", "type")) or i["type"] not in ("boolean", "number", "enum", "text"):
            raise field_error("schema", "invalid", "Каждый пункт должен иметь key, label и type (boolean/number/enum/text).")
        if i["key"] in keys:
            raise field_error("schema", "duplicate", f"Повторяющийся ключ пункта: {i['key']}.")
        keys.add(i["key"])
        if i["type"] == "enum" and not i.get("options"):
            raise field_error("schema", "invalid", f"Для пункта {i['key']} нужны options.")


@router.get("/checklist-templates")
def list_templates(equipment_type: str | None = None, status: str | None = None, code: str | None = None,
                   ctx: Ctx = Depends(require("admin", "dispatcher", "manager", "engineer")), db: DbSession = Depends(get_db, scope="function")):
    qy = select(ChecklistTemplate)
    if equipment_type:
        qy = qy.where(ChecklistTemplate.equipment_type == equipment_type)
    if status:
        qy = qy.where(ChecklistTemplate.status == status)
    if code:
        qy = qy.where(ChecklistTemplate.code == code)
    return [tpl_out(t, False) for t in db.scalars(qy.order_by(ChecklistTemplate.code, ChecklistTemplate.version.desc()))]


@router.get("/checklist-templates/{tpl_id}")
def get_template(tpl_id: str, ctx: Ctx = Depends(require("admin", "dispatcher", "manager", "engineer")), db: DbSession = Depends(get_db, scope="function")):
    t = db.get(ChecklistTemplate, _uuid(tpl_id))
    if not t:
        raise not_found()
    return tpl_out(t)


@router.post("/checklist-templates", status_code=201)
def create_template(body: TemplateIn, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    _validate_schema(body.schema_)
    last = db.scalar(select(ChecklistTemplate.version).where(ChecklistTemplate.code == body.code).order_by(ChecklistTemplate.version.desc()).limit(1))
    t = ChecklistTemplate(code=body.code, version=(last or 0) + 1, equipment_type=body.equipment_type, title=body.title,
                          schema=body.schema_, status="draft", created_by=ctx.user.id, created_at=clock.now())
    db.add(t)
    db.flush()
    return tpl_out(t)


@router.patch("/checklist-templates/{tpl_id}")
def patch_template(tpl_id: str, body: TemplatePatch, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    t = db.scalar(select(ChecklistTemplate).where(ChecklistTemplate.id == _uuid(tpl_id)).with_for_update())
    if not t:
        raise not_found()
    if t.status != "draft":
        raise conflict("TEMPLATE_PUBLISHED", "Опубликованную версию менять нельзя — создайте новую версию.")
    if body.schema_ is not None:
        _validate_schema(body.schema_)
        t.schema = body.schema_
    if body.title:
        t.title = body.title
    return tpl_out(t)


@router.post("/checklist-templates/{tpl_id}/publish")
def publish_template(tpl_id: str, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    t = db.scalar(select(ChecklistTemplate).where(ChecklistTemplate.id == _uuid(tpl_id)).with_for_update())
    if not t:
        raise not_found()
    if t.status != "draft":
        raise conflict("TEMPLATE_PUBLISHED", "Версия уже опубликована.")
    _validate_schema(t.schema)
    now = clock.now()
    prev = db.scalar(select(ChecklistTemplate).where(ChecklistTemplate.equipment_type == t.equipment_type,
                                                     ChecklistTemplate.status == "active").with_for_update())
    if prev:
        prev.status, prev.retired_at = "retired", now
        db.flush()
    t.status, t.published_at = "active", now
    audit(db, "template_published", user=ctx.user, object_type="checklist_template", object_id=t.id, request=request,
          details={"code": t.code, "version": t.version})
    return tpl_out(t)


@router.post("/checklist-templates/{tpl_id}/new-version", status_code=201)
def new_version(tpl_id: str, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    src = db.get(ChecklistTemplate, _uuid(tpl_id))
    if not src:
        raise not_found()
    last = db.scalar(select(ChecklistTemplate.version).where(ChecklistTemplate.code == src.code).order_by(ChecklistTemplate.version.desc()).limit(1))
    t = ChecklistTemplate(code=src.code, version=last + 1, equipment_type=src.equipment_type, title=src.title,
                          schema=src.schema, status="draft", created_by=ctx.user.id, created_at=clock.now())
    db.add(t)
    db.flush()
    return tpl_out(t)
