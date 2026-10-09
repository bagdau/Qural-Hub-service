"""Акты, уведомления, аналитика, настройки SLA, аудит, health."""
import uuid
from datetime import datetime, timedelta

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session as DbSession

from .. import clock, metrics, pdf, sla, storage
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError, not_found
from ..models import Act, AuditLog, Notification, SlaPolicy, Ticket, User
from ..schemas import SlaPut
from ..security import Ctx, audit, audit_isolated, get_ctx, require
from ..serializers import page_of, ticket_outs
from ..visibility import get_ticket
from .common import Page, paginate, strict_params

router = APIRouter(tags=["misc"])


def _uuid(x):
    try:
        return uuid.UUID(str(x))
    except ValueError:
        raise not_found()


# ---------------- акты ----------------
def act_out(a: Act, users: dict | None = None) -> dict:
    return {"id": a.id, "ticket_id": a.ticket_id, "version": a.version, "number": a.number, "is_current": a.is_current,
            "generated_at": a.generated_at, "size_bytes": a.size_bytes, "decision": a.decision, "decided_at": a.decided_at,
            "decision_comment": a.decision_comment, "rating": a.rating, "superseded_at": a.superseded_at,
            "sha256": a.sha256, "layout_version": a.layout_version}


def _act(db: DbSession, ctx: Ctx, act_id) -> Act:
    a = db.get(Act, _uuid(act_id))
    if not a:
        raise not_found()
    try:
        get_ticket(db, ctx, a.ticket_id)
    except ApiError:
        audit_isolated("access_denied", user=ctx.user, object_type="act", object_id=a.id)
        raise
    return a


@router.get("/tickets/{ticket_id}/acts")
def ticket_acts(ticket_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    return [act_out(a) for a in db.scalars(select(Act).where(Act.ticket_id == t.id).order_by(Act.version))]


@router.get("/acts/{act_id}")
def get_act(act_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    return act_out(_act(db, ctx, act_id))


@router.get("/acts/{act_id}/pdf")
def act_pdf(act_id: str, download: int = 0, request: Request = None, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    a = _act(db, ctx, act_id)
    if not storage.exists(a.storage_key):
        raise ApiError(500, "FILE_MISSING", "Файл акта не найден в хранилище.")
    audit(db, "act_downloaded", user=ctx.user, object_type="act", object_id=a.id, request=request)
    return Response(storage.read(a.storage_key), media_type="application/pdf", headers={
        "Content-Disposition": f'{"attachment" if download else "inline"}; filename="{a.number}.pdf"',
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.get("/acts/{act_id}/confirmation.pdf")
def confirmation_pdf(act_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    a = _act(db, ctx, act_id)
    if a.decision != "confirmed":
        raise not_found("Акт не подтверждён.")
    who = db.get(User, a.decided_by)
    t = db.get(Ticket, a.ticket_id)
    data = pdf.render_confirmation({
        "Акт": a.number, "Заявка": t.number, "Подтвердил": who.full_name,
        "Дата и время (UTC)": a.decided_at.strftime("%Y-%m-%d %H:%M:%S"), "Версия акта": a.version,
        "SHA-256 файла акта": a.sha256, "Оценка": a.rating or "—", "Комментарий": a.decision_comment or "—"})
    return Response(data, media_type="application/pdf", headers={"Cache-Control": "private, no-store"})


# ---------------- уведомления ----------------
def notif_out(n: Notification) -> dict:
    return {"id": n.id, "type": n.type, "title": n.title, "body": n.body, "ticket_id": n.ticket_id,
            "created_at": n.created_at, "read_at": n.read_at}


@router.get("/notifications")
def notifications(unread: bool = False, pg: Page = Depends(), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    q = select(Notification).where(Notification.user_id == ctx.user.id)
    if unread:
        q = q.where(Notification.read_at.is_(None))
    q = q.order_by(Notification.created_at.desc(), Notification.id)
    rows, total = paginate(db, q, pg)
    return page_of([notif_out(n) for n in rows], total, pg.page, pg.page_size)


@router.get("/notifications/unread-count")
def unread_count(ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    return {"count": db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == ctx.user.id, Notification.read_at.is_(None)))}


@router.post("/notifications/read-all", status_code=204)
def read_all(ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    now = clock.now()
    for n in db.scalars(select(Notification).where(Notification.user_id == ctx.user.id, Notification.read_at.is_(None))):
        n.read_at = now
    return Response(status_code=204)


@router.post("/notifications/{nid}/read", status_code=204)
def read_one(nid: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    n = db.scalar(select(Notification).where(Notification.id == _uuid(nid), Notification.user_id == ctx.user.id))
    if not n:
        raise not_found()
    n.read_at = n.read_at or clock.now()
    return Response(status_code=204)


# ---------------- аналитика ----------------
def _range(frm: datetime | None, to: datetime | None):
    now = clock.now()
    return (frm or now - timedelta(days=30)), (to or now), now


def _flt(ctx: Ctx, organization_id, site_id, equipment_type):
    org = ctx.user.organization_id if ctx.role == "client" else (_uuid(organization_id) if organization_id else None)
    return {"organization_id": org, "site_id": _uuid(site_id) if site_id else None, "equipment_type": equipment_type}


@router.get("/analytics/summary")
def analytics_summary(frm: datetime | None = Query(None, alias="from"), to: datetime | None = None,
                      organization_id: str | None = None, site_id: str | None = None, equipment_type: str | None = None,
                      ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    f, t, now = _range(frm, to)
    return metrics.summary(db, ctx, now, f, t, **_flt(ctx, organization_id, site_id, equipment_type))


@router.get("/analytics/metric-tickets")
def metric_tickets(metric: str, frm: datetime | None = Query(None, alias="from"), to: datetime | None = None,
                   organization_id: str | None = None, site_id: str | None = None, equipment_type: str | None = None,
                   pg: Page = Depends(), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    names = {"active": "active", "overdue": "overdue", "reaction": "reaction", "completion": "completion",
             "on_time": "on_time", "repeat": "repeat", "awaiting_reaction": "awaiting_reaction", "period": "period"}
    if metric not in names:
        raise ApiError(422, "VALIDATION_ERROR", "Неизвестная метрика.", {"fields": [{"field": "metric", "code": "invalid", "message": "Недопустимая метрика."}]})
    f, t, now = _range(frm, to)
    s = metrics.metric_sets(db, ctx, now, f, t, **_flt(ctx, organization_id, site_id, equipment_type))
    rows = sorted(s[names[metric]], key=lambda x: x.created_at, reverse=True)
    sl = rows[pg.offset: pg.offset + pg.page_size]
    outs = ticket_outs(db, ctx, sl)
    if metric == "overdue":
        for o, tk in zip(outs, sl):
            o["overdue_kind"] = sla.overdue_kind(tk, now)
    return page_of(outs, len(rows), pg.page, pg.page_size)


@router.get("/analytics/engineer-load")
def engineer_load(ctx: Ctx = Depends(require("admin", "dispatcher", "manager", "engineer")), db: DbSession = Depends(get_db)):
    return metrics.engineer_loads(db, ctx)


# ---------------- настройки SLA, аудит ----------------
def _pol(db):
    pol = sla.load_policy(db)
    rows = {r.priority: r for r in db.scalars(select(SlaPolicy))}
    return [{"priority": p, "reaction_minutes": pol[p][0], "resolution_minutes": pol[p][1],
             "version": rows[p].version if p in rows else 0} for p in ["critical", "high", "normal", "low"]]


@router.get("/settings/sla")
def get_sla(ctx: Ctx = Depends(require("admin", "dispatcher", "manager")), db: DbSession = Depends(get_db)):
    return _pol(db)


@router.put("/settings/sla")
def put_sla(body: SlaPut, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db)):
    now = clock.now()
    for it in body.items:
        if it.reaction_minutes >= it.resolution_minutes:
            raise ApiError(422, "VALIDATION_ERROR", "Срок реакции должен быть меньше срока выполнения.",
                           {"fields": [{"field": it.priority, "code": "invalid", "message": "Реакция < выполнения."}]})
        row = db.get(SlaPolicy, it.priority)
        if row:
            row.reaction_minutes, row.resolution_minutes = it.reaction_minutes, it.resolution_minutes
            row.updated_by, row.updated_at, row.version = ctx.user.id, now, row.version + 1
        else:
            db.add(SlaPolicy(priority=it.priority, reaction_minutes=it.reaction_minutes,
                             resolution_minutes=it.resolution_minutes, updated_by=ctx.user.id, updated_at=now))
    audit(db, "sla_policy_changed", user=ctx.user, request=request, details={"items": [i.model_dump() for i in body.items]})
    db.flush()
    return _pol(db)


@router.get("/audit-log")
def audit_log(request: Request, action: str | None = None, actor_user_id: str | None = None,
              pg: Page = Depends(), ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db)):
    strict_params(request, {"action", "actor_user_id"})
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action == action)
    if actor_user_id:
        q = q.where(AuditLog.actor_user_id == _uuid(actor_user_id))
    q = q.order_by(AuditLog.id.desc())
    rows, total = paginate(db, q, pg)
    return page_of([{"id": r.id, "occurred_at": r.occurred_at, "actor_user_id": r.actor_user_id, "actor_role": r.actor_role,
                     "action": r.action, "object_type": r.object_type, "object_id": r.object_id,
                     "ip": str(r.ip) if r.ip else None, "details": r.details} for r in rows], total, pg.page, pg.page_size)


# ---------------- health ----------------
@router.get("/health/live")
def live():
    return {"status": "ok"}


@router.get("/health/ready")
def ready(db: DbSession = Depends(get_db)):
    checks = {}
    try:
        db.execute(text("SELECT 1"))
        checks["db"] = "ok"
        cfg = Config()
        cfg.set_main_option("script_location", str(__import__("pathlib").Path(__file__).resolve().parents[2] / "migrations"))
        head = ScriptDirectory.from_config(cfg).get_current_head()
        cur = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        checks["migrations"] = "ok" if cur == head else "fail"
    except Exception:  # noqa: BLE001
        checks.setdefault("db", "fail")
        checks.setdefault("migrations", "fail")
    checks["storage"] = "ok" if storage.writable() else "fail"
    ok = all(v == "ok" for v in checks.values())
    from fastapi.responses import JSONResponse
    return JSONResponse({"status": "ok" if ok else "unavailable", "checks": checks, "version": get_settings().app_version},
                        status_code=200 if ok else 503)
