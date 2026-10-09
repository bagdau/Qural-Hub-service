import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DbSession

from .. import clock, idempotency, sla, workflow
from ..db import get_db
from ..errors import ApiError, conflict, not_found
from ..models import Assignment, Comment, Equipment, Ticket, TicketEvent, User
from ..schemas import (AcceptIn, AssignIn, CancelIn, CommentIn, ConfirmIn, PauseIn, PriorityIn, ReassignIn, RejectIn,
                       ResumeIn, ReturnIn, TicketCreate, TicketPatch, VersionIn)
from ..security import Ctx, audit, get_ctx
from ..serializers import allowed_actions, events_for, page_of, ticket_outs
from ..visibility import equipment_conditions, get_ticket, ticket_conditions, tickets_select
from .common import Page, apply_sort, paginate, strict_params, version_check

router = APIRouter(tags=["tickets"])


def _uuid(x):
    try:
        return uuid.UUID(str(x))
    except ValueError:
        raise not_found()


@router.get("/tickets")
def list_tickets(request: Request, status: list[str] = Query(default=[]), priority: list[str] = Query(default=[]),
                 kind: str | None = None, organization_id: str | None = None, site_id: str | None = None,
                 equipment_id: str | None = None, assigned_engineer_id: str | None = None, overdue: bool | None = None,
                 created_from: datetime | None = None, created_to: datetime | None = None, q: str | None = None,
                 archived: bool = False, sort: str | None = None, pg: Page = Depends(),
                 ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    strict_params(request, {"status", "priority", "kind", "organization_id", "site_id", "equipment_id",
                            "assigned_engineer_id", "overdue", "created_from", "created_to", "q", "archived"})
    qy = tickets_select(ctx)
    if status:
        qy = qy.where(Ticket.status.in_(status))
    if priority:
        qy = qy.where(Ticket.priority.in_(priority))
    if kind:
        qy = qy.where(Ticket.kind == kind)
    if organization_id:
        qy = qy.where(Ticket.organization_id == _uuid(organization_id))
    if site_id:
        qy = qy.where(Ticket.site_id == _uuid(site_id))
    if equipment_id:
        qy = qy.where(Ticket.equipment_id == _uuid(equipment_id))
    if assigned_engineer_id:
        qy = qy.where(Ticket.assigned_engineer_id == _uuid(assigned_engineer_id))
    if created_from:
        qy = qy.where(Ticket.created_at >= created_from)
    if created_to:
        qy = qy.where(Ticket.created_at <= created_to)
    if q:
        like = f"%{q}%"
        qy = qy.where(or_(Ticket.number.ilike(like), Ticket.title.ilike(like),
                          Ticket.equipment_id.in_(select(Equipment.id).where(Equipment.inventory_number.ilike(like)))))
    qy = qy.where(Ticket.archived_at.is_not(None) if archived else Ticket.archived_at.is_(None))
    if overdue:
        now = clock.now()
        ids = [t.id for t in db.scalars(qy) if sla.overdue_kind(t, now)]
        qy = qy.where(Ticket.id.in_(ids))
    prio_rank = func.array_position(["critical", "high", "normal", "low"], Ticket.priority)
    qy = apply_sort(qy, sort, {"created_at": Ticket.created_at, "priority": prio_rank, "sla_due_at": Ticket.sla_due_at,
                               "status": Ticket.status, "number": Ticket.number}, [Ticket.created_at.desc(), Ticket.id])
    rows, total = paginate(db, qy, pg)
    return page_of(ticket_outs(db, ctx, list(rows)), total, pg.page, pg.page_size)


@router.post("/tickets", status_code=201)
def create(body: TicketCreate, request: Request, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    def go():
        t, warnings = workflow.create_ticket(db, ctx, body)
        out = ticket_outs(db, ctx, [t])[0]
        out["warnings"] = warnings
        return 201, out
    return idempotency.run(db, ctx, request, body.model_dump(mode="json"), go)


@router.get("/tickets/{ticket_id}")
def get(ticket_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    return ticket_outs(db, ctx, [t])[0]


@router.patch("/tickets/{ticket_id}")
def patch(ticket_id: str, body: TicketPatch, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    t = get_ticket(db, ctx, _uuid(ticket_id), for_update=True)
    version_check(t, body.version, "Заявка")
    if "edit" not in allowed_actions(t, ctx):
        if t.status in sla.TERMINAL or t.status == "awaiting_confirmation":
            raise conflict("TICKET_LOCKED", "Заявку в этом статусе изменить нельзя.")
        raise ApiError(403, "FORBIDDEN", "Недостаточно прав для изменения заявки.")
    data = body.model_dump(exclude_unset=True, exclude={"version"})
    if ctx.role == "client":
        data = {k: v for k, v in data.items() if k in ("title", "description", "contact_name", "contact_phone")}
    now = clock.now()
    diff = {}
    for k, v in data.items():
        old = getattr(t, k)
        if old != v:
            diff[k] = {"from": old, "to": v}
            setattr(t, k, v)
    if diff:
        t.version += 1
        t.updated_at = now
        workflow.add_event(db, t, "edited", now, actor=ctx.user, request_id=ctx.request_id, payload=diff)
    db.flush()
    return ticket_outs(db, ctx, [t])[0]


@router.get("/tickets/{ticket_id}/events")
def events(ticket_id: str, pg: Page = Depends(), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    items, total = events_for(db, ctx, t.id, pg.page, pg.page_size)
    return page_of(items, total, pg.page, pg.page_size)


# ---------------- переходы ----------------
def _action(name: str, model):
    def endpoint(ticket_id: str, body: model, request: Request, ctx: Ctx = Depends(get_ctx),
                 db: DbSession = Depends(get_db)):
        tid = _uuid(ticket_id)

        def go():
            t, warnings = workflow.apply_action(db, ctx, tid, name, body)
            out = ticket_outs(db, ctx, [t])[0]
            out["warnings"] = warnings
            return 200, out
        required = name not in ("priority", "reassign")
        return idempotency.run(db, ctx, request, {"id": str(tid), **body.model_dump(mode="json")}, go, required=required)
    endpoint.__name__ = f"action_{name}"
    router.add_api_route(f"/tickets/{{ticket_id}}/{name}", endpoint, methods=["POST"])


for _n, _m in [("accept", AcceptIn), ("reject", RejectIn), ("assign", AssignIn), ("reassign", ReassignIn),
               ("start", VersionIn), ("pause", PauseIn), ("resume", ResumeIn), ("complete", VersionIn),
               ("confirm", ConfirmIn), ("return", ReturnIn), ("cancel", CancelIn), ("priority", PriorityIn)]:
    _action(_n, _m)


def _archive_route(action: str):
    def endpoint(ticket_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
        if ctx.role != "admin":
            raise ApiError(403, "FORBIDDEN", "Недостаточно прав.")
        t = get_ticket(db, ctx, _uuid(ticket_id), for_update=True)
        if action == "archive":
            if t.status not in sla.TERMINAL:
                raise conflict("INVALID_TRANSITION", "Архивировать можно только завершённые заявки.")
            t.archived_at = clock.now()
        else:
            t.archived_at = None
        t.version += 1
        workflow.add_event(db, t, action + "d", clock.now(), actor=ctx.user, request_id=ctx.request_id, visibility="internal")
        return ticket_outs(db, ctx, [t])[0]
    endpoint.__name__ = f"ticket_{action}"
    router.add_api_route(f"/tickets/{{ticket_id}}/{action}", endpoint, methods=["POST"])


_archive_route("archive")
_archive_route("unarchive")


# ---------------- назначения, комментарии, задания ----------------
@router.get("/tickets/{ticket_id}/assignments")
def assignments(ticket_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    rows = db.scalars(select(Assignment).where(Assignment.ticket_id == t.id).order_by(Assignment.assigned_at)).all()
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.engineer_id for r in rows} | {r.assigned_by for r in rows})))}
    if ctx.role == "client":
        cur = [r for r in rows if r.ended_at is None]
        return [{"engineer": {"id": users[r.engineer_id].id, "full_name": users[r.engineer_id].full_name}} for r in cur]
    return [{"id": r.id, "engineer": {"id": r.engineer_id, "full_name": users[r.engineer_id].full_name},
             "assigned_by": {"id": r.assigned_by, "full_name": users[r.assigned_by].full_name},
             "assigned_at": r.assigned_at, "scheduled_at": r.scheduled_at, "ended_at": r.ended_at,
             "end_reason": r.end_reason, "comment": r.comment} for r in rows]


@router.get("/engineers/{engineer_id}/workload")
def workload(engineer_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    if ctx.role not in ("admin", "dispatcher", "manager", "engineer") or (ctx.role == "engineer" and str(ctx.user.id) != engineer_id):
        raise ApiError(403, "FORBIDDEN", "Недостаточно прав.")
    e = db.get(User, _uuid(engineer_id))
    if not e or e.role != "engineer":
        raise not_found()
    ts = list(db.scalars(select(Ticket).where(Ticket.assigned_engineer_id == e.id,
                                              Ticket.status.in_(["assigned", "in_progress", "paused"]))))
    load = len(ts)
    return {"capacity": e.capacity, "load": load, "load_pct": round(100 * load / e.capacity, 1),
            "tickets": ticket_outs(db, ctx, ts)}


def comment_out(c: Comment, users: dict) -> dict:
    a = users.get(c.author_id)
    return {"id": c.id, "body": c.body, "visibility": c.visibility, "created_at": c.created_at,
            "author": {"id": a.id, "full_name": a.full_name, "role": a.role} if a else None}


@router.get("/tickets/{ticket_id}/comments")
def list_comments(ticket_id: str, pg: Page = Depends(), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    qy = select(Comment).where(Comment.ticket_id == t.id)
    if ctx.role == "client":
        qy = qy.where(Comment.visibility == "public")
    qy = qy.order_by(Comment.created_at, Comment.id)
    rows, total = paginate(db, qy, pg)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.author_id for r in rows})))}
    return page_of([comment_out(c, users) for c in rows], total, pg.page, pg.page_size)


@router.post("/tickets/{ticket_id}/comments", status_code=201)
def add_comment(ticket_id: str, body: CommentIn, request: Request, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    tid = _uuid(ticket_id)

    def go():
        t = get_ticket(db, ctx, tid)
        vis = body.visibility or ("internal" if ctx.role == "manager" else "public")
        if ctx.role == "client" and vis == "internal":
            raise ApiError(403, "FORBIDDEN", "Клиент не может оставлять внутренние комментарии.")
        now = clock.now()
        c = Comment(ticket_id=t.id, author_id=ctx.user.id, body=body.body, visibility=vis, created_at=now)
        db.add(c)
        db.flush()
        workflow.add_event(db, t, "comment_added", now, actor=ctx.user, request_id=ctx.request_id, visibility=vis,
                           payload={"comment_id": str(c.id)})
        return 201, comment_out(c, {ctx.user.id: ctx.user})
    return idempotency.run(db, ctx, request, {"id": str(tid), **body.model_dump(mode="json")}, go)


@router.get("/me/tasks")
def my_tasks(group: str | None = None, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    if ctx.role != "engineer":
        raise ApiError(403, "FORBIDDEN", "Раздел доступен инженерам.")
    now = clock.now()
    ts = list(db.scalars(tickets_select(ctx).where(Ticket.archived_at.is_(None)).order_by(Ticket.created_at.desc())))
    outs = ticket_outs(db, ctx, ts)
    groups = {"today": [], "upcoming": [], "paused": [], "awaiting": [], "done": []}
    for o in outs:
        st = o["status"]
        if st in ("assigned", "in_progress"):
            sched = o["scheduled_at"]
            (groups["upcoming"] if sched and sched.date() > now.date() else groups["today"]).append(o)
        elif st == "paused":
            groups["paused"].append(o)
        elif st == "awaiting_confirmation":
            groups["awaiting"].append(o)
        elif st == "closed":
            groups["done"].append(o)
    for k in ("today",):
        groups[k].sort(key=lambda o: (["critical", "high", "normal", "low"].index(o["priority"]), o["created_at"]))
    return groups[group] if group in groups else groups


@router.get("/search")
def search(q: str = Query(..., min_length=2, max_length=100), limit: int = Query(10, ge=1, le=20),
           ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    like = f"%{q.strip()}%"
    eqs = db.scalars(select(Equipment).where(
        or_(Equipment.name.ilike(like), Equipment.inventory_number.ilike(like), Equipment.serial_number.ilike(like),
            Equipment.qr_code == q.strip().upper()), *equipment_conditions(ctx)).limit(limit)).all()
    ts = db.scalars(tickets_select(ctx).where(or_(Ticket.number.ilike(like), Ticket.title.ilike(like)))
                    .order_by(Ticket.created_at.desc()).limit(limit)).all()
    return {"equipment": [{"id": e.id, "name": e.name, "inventory_number": e.inventory_number, "type": e.type} for e in eqs],
            "tickets": [{"id": t.id, "number": t.number, "title": t.title, "status": t.status} for t in ts]}
