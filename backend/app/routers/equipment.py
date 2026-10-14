import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session as DbSession

from .. import clock, metrics
from ..generators import documents, qr as qrgen
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError, conflict, field_error, not_found
from ..models import (Act, Assignment, Equipment, MaintenancePlan, Organization, PartUsage, Site, SparePart, Ticket,
                      WorkReport)
from ..schemas import EquipmentIn, EquipmentPatch, PlanIn, PlanPatch, VersionIn
from ..security import Ctx, audit, get_ctx, require
from ..serializers import page_of
from ..sla import ACTIVE
from ..visibility import equipment_conditions, get_equipment, ticket_conditions
from .common import Page, apply_sort, paginate, strict_params, version_check

router = APIRouter(tags=["equipment"])
QR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
TYPE_LABELS = {"transformer": "Трансформатор", "substation": "Подстанция (КТП)", "switchgear": "Распределительное устройство"}


def new_qr(db: DbSession) -> str:
    while True:
        code = "".join(secrets.choice(QR_ALPHABET) for _ in range(12))
        if not db.scalar(select(Equipment.id).where(Equipment.qr_code == code)):
            return code


def _uuid(x):
    try:
        return uuid.UUID(str(x))
    except ValueError:
        raise not_found()


def eq_brief(e: Equipment, site: Site | None = None, extra: dict | None = None) -> dict:
    d = {"id": e.id, "organization_id": e.organization_id, "site_id": e.site_id, "type": e.type,
         "type_label": TYPE_LABELS[e.type], "inventory_number": e.inventory_number, "name": e.name,
         "manufacturer": e.manufacturer, "model": e.model, "serial_number": e.serial_number,
         "technical_state": e.technical_state, "archived_at": e.archived_at, "version": e.version}
    if site:
        d["site"] = {"id": site.id, "name": site.name, "address": site.address}
    if extra:
        d.update(extra)
    return d


def eq_full(db: DbSession, ctx: Ctx, e: Equipment) -> dict:
    site = db.get(Site, e.site_id)
    org = db.get(Organization, e.organization_id)
    d = eq_brief(e, site)
    d.update({"organization": {"id": org.id, "name": org.name}, "manufacture_year": e.manufacture_year,
              "commissioned_on": e.commissioned_on, "voltage_class_kv": float(e.voltage_class_kv) if e.voltage_class_kv else None,
              "rated_power_kva": float(e.rated_power_kva) if e.rated_power_kva else None,
              "location_description": e.location_description, "passport_data": e.passport_data, "notes": e.notes,
              "qr_code": e.qr_code if ctx.role in ("admin", "dispatcher", "engineer", "manager", "client") else None,
              "qr_url": f"{get_settings().app_public_url}/e/{e.qr_code}", "created_at": e.created_at})
    conds = ticket_conditions(ctx)
    d["active_tickets_count"] = db.scalar(select(func.count()).select_from(Ticket).where(
        Ticket.equipment_id == e.id, Ticket.status.in_(list(ACTIVE)), *conds))
    plan = db.scalar(select(MaintenancePlan).where(MaintenancePlan.equipment_id == e.id, MaintenancePlan.is_active.is_(True))
                     .order_by(MaintenancePlan.next_due_date).limit(1))
    d["next_due_date"] = plan.next_due_date if plan else None
    d["last_done_on"] = db.scalar(select(func.max(MaintenancePlan.last_done_on)).where(MaintenancePlan.equipment_id == e.id))
    now = clock.now()
    recent = list(db.scalars(select(Ticket).where(Ticket.equipment_id == e.id, Ticket.kind == "corrective",
                                                  Ticket.status.notin_(["rejected", "cancelled"]),
                                                  Ticket.created_at >= now - timedelta(days=90), *conds)))
    d["repeat_failures_90d"] = len(metrics.repeat_tickets(db, recent))
    return d


@router.get("/equipment")
def list_equipment(request: Request, organization_id: str | None = None, site_id: str | None = None,
                   type: str | None = None, technical_state: str | None = None, has_active_tickets: bool | None = None,
                   q: str | None = None, archived: bool = False, sort: str | None = None, pg: Page = Depends(),
                   ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    strict_params(request, {"organization_id", "site_id", "type", "technical_state", "has_active_tickets", "q", "archived"})
    qy = select(Equipment).where(*equipment_conditions(ctx))
    if organization_id:
        qy = qy.where(Equipment.organization_id == _uuid(organization_id))
    if site_id:
        qy = qy.where(Equipment.site_id == _uuid(site_id))
    if type:
        qy = qy.where(Equipment.type == type)
    if technical_state:
        qy = qy.where(Equipment.technical_state == technical_state)
    if has_active_tickets is not None:
        sub = exists().where(Ticket.equipment_id == Equipment.id, Ticket.status.in_(list(ACTIVE)))
        qy = qy.where(sub if has_active_tickets else ~sub)
    if q:
        like = f"%{q}%"
        qy = qy.where(or_(Equipment.name.ilike(like), Equipment.inventory_number.ilike(like),
                          Equipment.serial_number.ilike(like)))
    qy = qy.where(Equipment.archived_at.is_not(None) if archived else Equipment.archived_at.is_(None))
    qy = apply_sort(qy, sort, {"name": Equipment.name, "inventory_number": Equipment.inventory_number,
                               "created_at": Equipment.created_at}, [Equipment.name, Equipment.id])
    rows, total = paginate(db, qy, pg)
    sites = {s.id: s for s in db.scalars(select(Site).where(Site.id.in_({e.site_id for e in rows})))} if rows else {}
    act_counts = dict(db.execute(select(Ticket.equipment_id, func.count()).where(
        Ticket.equipment_id.in_([e.id for e in rows]), Ticket.status.in_(list(ACTIVE)), *ticket_conditions(ctx))
        .group_by(Ticket.equipment_id)).all()) if rows else {}
    nxt = dict(db.execute(select(MaintenancePlan.equipment_id, func.min(MaintenancePlan.next_due_date)).where(
        MaintenancePlan.equipment_id.in_([e.id for e in rows]), MaintenancePlan.is_active.is_(True))
        .group_by(MaintenancePlan.equipment_id)).all()) if rows else {}
    items = [eq_brief(e, sites.get(e.site_id), {"active_tickets_count": act_counts.get(e.id, 0),
                                               "next_due_date": nxt.get(e.id)}) for e in rows]
    return page_of(items, total, pg.page, pg.page_size)


@router.post("/equipment", status_code=201)
def create_equipment(body: EquipmentIn, request: Request, ctx: Ctx = Depends(require("admin", "dispatcher")),
                     db: DbSession = Depends(get_db)):
    org = db.get(Organization, body.organization_id)
    if not org or org.kind != "client" or org.archived_at:
        raise field_error("organization_id", "invalid", "Выберите действующую клиентскую организацию.")
    site = db.get(Site, body.site_id)
    if not site or site.organization_id != org.id:
        raise field_error("site_id", "invalid", "Площадка должна принадлежать выбранной организации.")
    if body.type in ("transformer", "substation") and not body.rated_power_kva:
        raise field_error("rated_power_kva", "required", "Для трансформатора и подстанции укажите мощность.")
    if db.scalar(select(Equipment.id).where(Equipment.organization_id == org.id,
                                            Equipment.inventory_number == body.inventory_number)):
        raise conflict("DUPLICATE", "Оборудование с таким инвентарным номером уже есть у организации.")
    now = clock.now()
    e = Equipment(qr_code=new_qr(db), created_at=now, updated_at=now, **body.model_dump())
    db.add(e)
    db.flush()
    audit(db, "equipment_created", user=ctx.user, object_type="equipment", object_id=e.id, request=request)
    return eq_full(db, ctx, e)


@router.get("/equipment/by-qr/{code}")
def by_qr(code: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    e = db.scalar(select(Equipment).where(Equipment.qr_code == code.upper(), *equipment_conditions(ctx)))
    if not e:
        from ..security import audit_isolated
        if ctx.role in ("client", "engineer"):
            audit_isolated("access_denied", user=ctx.user, object_type="qr", object_id=code[:12])
        raise not_found("Оборудование не найдено или недоступно. Код мог быть перевыпущен.")
    my = None
    if ctx.role == "engineer":
        my = db.scalar(select(Ticket.id).where(Ticket.equipment_id == e.id, Ticket.assigned_engineer_id == ctx.user.id,
                                               Ticket.status.in_(["assigned", "in_progress", "paused", "awaiting_confirmation"]))
                       .order_by(Ticket.created_at.desc()).limit(1))
    return {"equipment_id": e.id, "redirect": f"/equipment/{e.id}", "my_active_ticket_id": my}


def _qr_url(e: Equipment) -> str:
    return f"{get_settings().app_public_url}/e/{e.qr_code}"


def _label_item(db: DbSession, e: Equipment) -> dict:
    site = db.get(Site, e.site_id)
    return {"code": e.qr_code, "url": _qr_url(e), "inventory": e.inventory_number, "name": e.name, "site": site.name if site else ""}


def _pdf(data: bytes, name: str, download: int = 0) -> Response:
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f'{"attachment" if download else "inline"}; filename="{name}"', "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"})


@router.get("/equipment/qr-layouts")
def qr_layouts(ctx: Ctx = Depends(get_ctx)):
    return [{"id": l.id, "title": l.title} for l in documents.LAYOUTS.values()]


@router.get("/equipment/qr-labels.pdf")
def qr_labels(ids: str = Query(...), layout: str = "sheet8", download: int = 0,
              ctx: Ctx = Depends(require("admin", "dispatcher")), db: DbSession = Depends(get_db)):
    id_list = [_uuid(i) for i in ids.split(",") if i][:48]
    if not id_list:
        raise field_error("ids", "required", "Выберите оборудование.")
    documents.layout(layout)
    rows = list(db.scalars(select(Equipment).where(Equipment.id.in_(id_list)).order_by(Equipment.inventory_number)))
    if not rows:
        raise not_found()
    return _pdf(documents.qr_labels([_label_item(db, e) for e in rows], layout), "qr-labels.pdf", download)


@router.get("/equipment/{equipment_id}")
def get_eq(equipment_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    return eq_full(db, ctx, get_equipment(db, ctx, _uuid(equipment_id)))


@router.patch("/equipment/{equipment_id}")
def patch_eq(equipment_id: str, body: EquipmentPatch, ctx: Ctx = Depends(require("admin", "dispatcher")),
             db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, _uuid(equipment_id), for_update=True)
    version_check(e, body.version, "Оборудование")
    if e.archived_at:
        raise conflict("EQUIPMENT_ARCHIVED", "Оборудование в архиве.")
    data = body.model_dump(exclude_unset=True, exclude={"version"})
    if "site_id" in data:
        s = db.get(Site, data["site_id"])
        if not s or s.organization_id != e.organization_id:
            raise field_error("site_id", "invalid", "Площадка должна принадлежать организации оборудования.")
    if "inventory_number" in data and data["inventory_number"] != e.inventory_number and db.scalar(
            select(Equipment.id).where(Equipment.organization_id == e.organization_id,
                                       Equipment.inventory_number == data["inventory_number"])):
        raise conflict("DUPLICATE", "Оборудование с таким инвентарным номером уже есть.")
    for k, v in data.items():
        setattr(e, k, v)
    e.version += 1
    e.updated_at = clock.now()
    db.flush()
    return eq_full(db, ctx, e)


@router.post("/equipment/{equipment_id}/archive")
def archive_eq(equipment_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")),
               db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, _uuid(equipment_id), for_update=True)
    version_check(e, body.version, "Оборудование")
    if db.scalar(select(func.count()).select_from(Ticket).where(Ticket.equipment_id == e.id, Ticket.status.in_(list(ACTIVE)))):
        raise conflict("HAS_ACTIVE_TICKETS", "По оборудованию есть активные заявки.")
    e.archived_at, e.version = clock.now(), e.version + 1
    audit(db, "entity_archived", user=ctx.user, object_type="equipment", object_id=e.id, request=request)
    return eq_full(db, ctx, e)


@router.post("/equipment/{equipment_id}/unarchive")
def unarchive_eq(equipment_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")),
                 db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, _uuid(equipment_id), for_update=True)
    version_check(e, body.version, "Оборудование")
    e.archived_at, e.version = None, e.version + 1
    audit(db, "entity_unarchived", user=ctx.user, object_type="equipment", object_id=e.id, request=request)
    return eq_full(db, ctx, e)


@router.get("/equipment/{equipment_id}/history")
def history(equipment_id: str, request: Request, kind: str | None = None, status: str | None = None,
            pg: Page = Depends(), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    strict_params(request, {"kind", "status"})
    e = get_equipment(db, ctx, _uuid(equipment_id))
    qy = select(Ticket).where(Ticket.equipment_id == e.id, *ticket_conditions(ctx))
    if ctx.role == "engineer":
        # инженеру доступна техническая история по оборудованию заявок, которые ему видны (4.3)
        qy = select(Ticket).where(Ticket.equipment_id == e.id, Ticket.status.in_(["closed", "awaiting_confirmation"]) |
                                  Ticket.id.in_(select(Ticket.id).where(*ticket_conditions(ctx))))
    if kind:
        qy = qy.where(Ticket.kind == kind)
    if status:
        qy = qy.where(Ticket.status == status)
    qy = qy.order_by(Ticket.created_at.desc(), Ticket.id)
    rows, total = paginate(db, qy, pg)
    items = []
    for t in rows:
        rep = db.scalar(select(WorkReport).where(WorkReport.ticket_id == t.id, WorkReport.status.in_(["submitted"]))
                        .order_by(WorkReport.revision.desc()).limit(1))
        parts = []
        if rep:
            parts = [{"name": s.name, "quantity": float(u.quantity), "unit": u.unit_snapshot} for u, s in db.execute(
                select(PartUsage, SparePart).join(SparePart, SparePart.id == PartUsage.spare_part_id)
                .where(PartUsage.work_report_id == rep.id))]
        act = db.scalar(select(Act).where(Act.ticket_id == t.id, Act.is_current.is_(True)))
        can_act = ctx.role != "engineer" or t.assigned_engineer_id == ctx.user.id
        items.append({"ticket": {"id": t.id, "number": t.number, "title": t.title, "kind": t.kind, "status": t.status,
                                 "priority": t.priority, "created_at": t.created_at, "closed_at": t.closed_at},
                      "diagnosis": rep.diagnosis if rep else None, "work_performed": rep.work_performed if rep else None,
                      "parts": parts, "current_act_id": act.id if (act and can_act) else None})
    return page_of(items, total, pg.page, pg.page_size)


@router.get("/equipment/{equipment_id}/qr")
def qr_image(equipment_id: str, format: str = "svg", size: int = Query(10, ge=2, le=40), ec: str = "q",
             border: int = Query(4, ge=4, le=10), download: int = 0, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, _uuid(equipment_id))
    url = _qr_url(e)
    if format == "png":
        data, mt, ext = qrgen.png(url, size, border, ec), "image/png", "png"
    elif format == "svg":
        data, mt, ext = qrgen.svg(url, size, border, ec), "image/svg+xml", "svg"
    else:
        raise field_error("format", "invalid", "Формат: svg или png.")
    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="qr-{e.inventory_number}.{ext}"'
    return Response(data, media_type=mt, headers=headers)


@router.get("/equipment/{equipment_id}/qr-label.pdf")
def qr_label_pdf(equipment_id: str, layout: str = "label100x70", download: int = 0, ctx: Ctx = Depends(get_ctx),
                 db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, _uuid(equipment_id))
    documents.layout(layout)
    return _pdf(documents.qr_labels([_label_item(db, e)], layout), f"qr-{e.inventory_number}.pdf", download)


@router.get("/equipment/{equipment_id}/passport.pdf")
def passport_pdf(equipment_id: str, download: int = 0, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, _uuid(equipment_id))
    d = eq_full(db, ctx, e)
    d["state_label"] = {"operational": "Исправно", "degraded": "Ограниченно", "out_of_service": "Выведено из работы"}[e.technical_state]
    for k in ("next_due_date", "last_done_on"):
        d[k] = d[k].strftime("%d.%m.%Y") if d.get(k) else None
    tickets = list(db.scalars(select(Ticket).where(Ticket.equipment_id == e.id, *ticket_conditions(ctx))
                              .order_by(Ticket.created_at.desc()).limit(14)))
    hist = []
    for t in tickets:
        rep = db.scalar(select(WorkReport).where(WorkReport.ticket_id == t.id, WorkReport.status == "submitted")
                        .order_by(WorkReport.revision.desc()).limit(1))
        hist.append({"number": t.number, "date": t.created_at.strftime("%d.%m.%Y"), "kind": "план" if t.kind == "planned" else "ремонт",
                     "status": t.status, "title": t.title, "diagnosis": rep.diagnosis if rep else None})
    return _pdf(documents.equipment_passport(d, hist, _qr_url(e)), f"passport-{e.inventory_number}.pdf", download)


@router.post("/equipment/{equipment_id}/qr/rotate")
def rotate_qr(equipment_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin", "dispatcher")),
              db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, _uuid(equipment_id), for_update=True)
    version_check(e, body.version, "Оборудование")
    e.qr_code, e.qr_rotated_at, e.version = new_qr(db), clock.now(), e.version + 1
    audit(db, "qr_rotated", user=ctx.user, object_type="equipment", object_id=e.id, request=request)
    return eq_full(db, ctx, e)


# ---------------- планы обслуживания ----------------
def plan_out(p: MaintenancePlan, e: Equipment | None = None) -> dict:
    d = {"id": p.id, "equipment_id": p.equipment_id, "title": p.title, "description": p.description,
         "interval_days": p.interval_days, "lead_days": p.lead_days, "priority": p.priority,
         "last_done_on": p.last_done_on, "next_due_date": p.next_due_date, "is_active": p.is_active, "version": p.version}
    if e:
        d["equipment"] = {"id": e.id, "name": e.name, "inventory_number": e.inventory_number}
    return d


@router.get("/maintenance-plans")
def list_plans(request: Request, equipment_id: str | None = None, is_active: bool | None = None,
               due_before: str | None = None, pg: Page = Depends(), ctx: Ctx = Depends(get_ctx),
               db: DbSession = Depends(get_db)):
    strict_params(request, {"equipment_id", "is_active", "due_before"})
    qy = select(MaintenancePlan, Equipment).join(Equipment, Equipment.id == MaintenancePlan.equipment_id).where(*equipment_conditions(ctx))
    if equipment_id:
        qy = qy.where(MaintenancePlan.equipment_id == _uuid(equipment_id))
    if is_active is not None:
        qy = qy.where(MaintenancePlan.is_active == is_active)
    if due_before:
        from datetime import date
        qy = qy.where(MaintenancePlan.next_due_date <= date.fromisoformat(due_before))
    qy = qy.order_by(MaintenancePlan.next_due_date, MaintenancePlan.id)
    total = db.scalar(select(func.count()).select_from(qy.order_by(None).subquery()))
    rows = db.execute(qy.offset(pg.offset).limit(pg.page_size)).all()
    return page_of([plan_out(p, e) for p, e in rows], total, pg.page, pg.page_size)


@router.post("/maintenance-plans", status_code=201)
def create_plan(body: PlanIn, ctx: Ctx = Depends(require("admin", "dispatcher")), db: DbSession = Depends(get_db)):
    e = get_equipment(db, ctx, body.equipment_id)
    if body.next_due_date < clock.now().date():
        raise field_error("next_due_date", "in_past", "Первая плановая дата не может быть в прошлом.")
    now = clock.now()
    p = MaintenancePlan(created_by=ctx.user.id, created_at=now, updated_at=now, **body.model_dump())
    db.add(p)
    db.flush()
    return plan_out(p, e)


@router.get("/maintenance-plans/{plan_id}")
def get_plan(plan_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    p = db.get(MaintenancePlan, _uuid(plan_id))
    if not p:
        raise not_found()
    e = get_equipment(db, ctx, p.equipment_id)
    return plan_out(p, e)


@router.patch("/maintenance-plans/{plan_id}")
def patch_plan(plan_id: str, body: PlanPatch, ctx: Ctx = Depends(require("admin", "dispatcher")), db: DbSession = Depends(get_db)):
    p = db.scalar(select(MaintenancePlan).where(MaintenancePlan.id == _uuid(plan_id)).with_for_update())
    if not p:
        raise not_found()
    version_check(p, body.version, "План")
    for k, v in body.model_dump(exclude_unset=True, exclude={"version"}).items():
        setattr(p, k, v)
    p.version += 1
    p.updated_at = clock.now()
    return plan_out(p, db.get(Equipment, p.equipment_id))


@router.post("/maintenance-plans/{plan_id}/{action}")
def toggle_plan(plan_id: str, action: str, body: VersionIn, ctx: Ctx = Depends(require("admin", "dispatcher")),
                db: DbSession = Depends(get_db)):
    if action not in ("activate", "deactivate"):
        raise not_found()
    p = db.scalar(select(MaintenancePlan).where(MaintenancePlan.id == _uuid(plan_id)).with_for_update())
    if not p:
        raise not_found()
    version_check(p, body.version, "План")
    p.is_active, p.version = action == "activate", p.version + 1
    return plan_out(p, db.get(Equipment, p.equipment_id))


@router.get("/maintenance/upcoming")
def upcoming(days: int = Query(14, ge=1, le=90), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    today = clock.now().date()
    rows = db.execute(select(MaintenancePlan, Equipment).join(Equipment, Equipment.id == MaintenancePlan.equipment_id)
                      .where(MaintenancePlan.is_active.is_(True), MaintenancePlan.next_due_date <= today + timedelta(days=days),
                             *equipment_conditions(ctx)).order_by(MaintenancePlan.next_due_date)).all()
    return [{**plan_out(p, e), "overdue": p.next_due_date < today} for p, e in rows]
