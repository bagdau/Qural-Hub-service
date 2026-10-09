from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from . import clock, sla
from .execution import work_stage
from .models import (Act, ChecklistTemplate, Comment, Equipment, Organization, PartUsage, Site, Ticket, TicketEvent, User,
                     WorkReport)
from .security import Ctx

# ---- действия и права (таблица 5.3) ----
ACTIVE_PLUS = {"new", "accepted", "assigned", "in_progress", "paused"}
ACTION_SPEC = {
    "accept": {"dispatcher": {"new"}},
    "reject": {"dispatcher": {"new"}},
    "assign": {"dispatcher": {"new", "accepted"}},
    "reassign": {"dispatcher": {"assigned", "in_progress", "paused"}},
    "start": {"engineer": {"assigned"}},
    "pause": {"engineer": {"in_progress"}, "dispatcher": {"in_progress"}},
    "resume": {"engineer": {"paused"}, "dispatcher": {"paused"}},
    "complete": {"engineer": {"in_progress"}},
    "confirm": {"client": {"awaiting_confirmation"}},
    "return": {"client": {"awaiting_confirmation"}},
    "cancel": {"client": {"new", "accepted", "assigned"}, "dispatcher": ACTIVE_PLUS},
    "priority": {"dispatcher": ACTIVE_PLUS},
}
ENGINEER_ASSIGNEE_ONLY = {"start", "pause", "resume", "complete"}


def action_allowed(action: str, t: Ticket, ctx: Ctx) -> bool:
    spec = ACTION_SPEC[action].get(ctx.role)
    if spec is None or t.status not in spec:
        return False
    if ctx.role == "engineer" and t.assigned_engineer_id != ctx.user.id:
        return False
    return True


def allowed_actions(t: Ticket, ctx: Ctx) -> list[str]:
    acts = [a for a in ACTION_SPEC if action_allowed(a, t, ctx)]
    if t.status in ACTIVE_PLUS and ctx.role == "dispatcher" or (t.status == "new" and ctx.role == "client"
                                                               and t.created_by == ctx.user.id):
        acts.append("edit")
    return acts


def user_brief(u: User | None) -> dict | None:
    return {"id": u.id, "full_name": u.full_name, "role": u.role} if u else None


def ticket_outs(db: DbSession, ctx: Ctx, tickets: list[Ticket]) -> list[dict]:
    if not tickets:
        return []
    now = clock.now()
    ids = [t.id for t in tickets]
    orgs = {o.id: o for o in db.scalars(select(Organization).where(Organization.id.in_({t.organization_id for t in tickets})))}
    sites = {s.id: s for s in db.scalars(select(Site).where(Site.id.in_({t.site_id for t in tickets})))}
    eqs = {e.id: e for e in db.scalars(select(Equipment).where(Equipment.id.in_({t.equipment_id for t in tickets})))}
    uids = {t.created_by for t in tickets if t.created_by} | {t.assigned_engineer_id for t in tickets if t.assigned_engineer_id}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(uids)))} if uids else {}
    acts = {a.ticket_id: a for a in db.scalars(select(Act).where(Act.ticket_id.in_(ids), Act.is_current.is_(True)))}
    drafts = {r.ticket_id: r for r in db.scalars(select(WorkReport).where(
        WorkReport.ticket_id.in_([t.id for t in tickets if t.status == "in_progress"]), WorkReport.status == "draft"))}
    # данные для карточек доски: прогресс чек-листа, число запчастей и комментариев
    reports: dict = {}
    for r in db.scalars(select(WorkReport).where(WorkReport.ticket_id.in_(ids)).order_by(WorkReport.revision.desc())):
        reports.setdefault(r.ticket_id, r)
    tpls = {x.id: x for x in db.scalars(select(ChecklistTemplate).where(
        ChecklistTemplate.id.in_({r.checklist_template_id for r in reports.values()})))} if reports else {}
    parts_cnt = dict(db.execute(select(PartUsage.work_report_id, func.count()).where(
        PartUsage.work_report_id.in_([r.id for r in reports.values()])).group_by(PartUsage.work_report_id)).all()) if reports else {}
    cq = select(Comment.ticket_id, func.count()).where(Comment.ticket_id.in_(ids))
    if ctx.role == "client":
        cq = cq.where(Comment.visibility == "public")
    comments_cnt = dict(db.execute(cq.group_by(Comment.ticket_id)).all())
    out = []
    for t in tickets:
        eq, site, org = eqs[t.equipment_id], sites[t.site_id], orgs[t.organization_id]
        act = acts.get(t.id)
        d = {
            "id": t.id, "number": t.number, "status": t.status, "kind": t.kind, "source": t.source,
            "priority": t.priority, "urgency": t.urgency, "title": t.title, "description": t.description,
            "organization": {"id": org.id, "name": org.name},
            "site": {"id": site.id, "name": site.name, "address": site.address},
            "equipment": {"id": eq.id, "name": eq.name, "inventory_number": eq.inventory_number, "type": eq.type,
                          "model": eq.model, "manufacturer": eq.manufacturer},
            "created_by": user_brief(users.get(t.created_by)),
            "assigned_engineer": user_brief(users.get(t.assigned_engineer_id)),
            "contact": {"name": t.contact_name, "phone": t.contact_phone},
            "scheduled_at": t.scheduled_at, "related_ticket_id": t.related_ticket_id,
            "work_stage": work_stage(drafts.get(t.id)),
            "pause": ({"reason_code": t.pause_reason_code, "comment": t.pause_comment, "next_action": t.pause_next_action,
                       "expected_resume_at": t.pause_expected_resume_at} if t.status == "paused" else None),
            "sla": sla.sla_view(t, now, full=ctx.is_service),
            "current_act": ({"id": act.id, "version": act.version, "number": act.number, "is_current": True,
                             "generated_at": act.generated_at, "decision": act.decision} if act else None),
            "checklist": _checklist_progress(reports.get(t.id), tpls),
            "parts_count": parts_cnt.get(reports[t.id].id, 0) if t.id in reports and ctx.role != "client" else 0,
            "comments_count": comments_cnt.get(t.id, 0),
            "return_count": t.return_count, "plan_due_date": t.plan_due_date,
            "allowed_actions": allowed_actions(t, ctx),
            "version": t.version, "created_at": t.created_at, "updated_at": t.updated_at, "archived_at": t.archived_at,
            "accepted_at": t.accepted_at, "started_at": t.started_at, "completed_at": t.completed_at,
            "closed_at": t.closed_at,
        }
        out.append(d)
    return out


def _checklist_progress(r, tpls) -> dict | None:
    if r is None:
        return None
    tpl = tpls.get(r.checklist_template_id)
    if tpl is None:
        return None
    items = [i for i in tpl.schema.get("items", []) if i.get("type") != "text"]
    answers = r.checklist_answers or {}

    def done(i):
        a = answers.get(i["key"])
        v = a.get("value") if isinstance(a, dict) else a
        return v is not None and v != ""
    return {"done": sum(1 for i in items if done(i)), "total": len(items)}


def event_out(e: TicketEvent, actors: dict, ctx: Ctx) -> dict:
    p, etype, comment = dict(e.payload or {}), e.event_type, e.comment
    if ctx.role == "client":
        if etype == "reassigned":
            etype, p, comment = "assigned", {"engineer_name": p.get("to_name")}, None
        else:
            p.pop("reason", None)
    a = actors.get(e.actor_user_id)
    return {"id": e.id, "event_type": etype, "from_status": e.from_status, "to_status": e.to_status,
            "comment": comment, "payload": p, "visibility": e.visibility,
            "actor": ({"id": a.id, "full_name": a.full_name, "role": a.role} if a else None),
            "created_at": e.created_at}


def events_for(db: DbSession, ctx: Ctx, ticket_id, page: int, page_size: int):
    q = select(TicketEvent).where(TicketEvent.ticket_id == ticket_id)
    if ctx.role == "client":
        q = q.where(TicketEvent.visibility == "public")
    from sqlalchemy import func
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(TicketEvent.id).offset((page - 1) * page_size).limit(page_size)).all()
    actors = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.actor_user_id for r in rows if r.actor_user_id})))}
    return [event_out(r, actors, ctx) for r in rows], total


def page_of(items, total, page, page_size) -> dict:
    return {"items": items, "page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, -(-total // page_size))}
