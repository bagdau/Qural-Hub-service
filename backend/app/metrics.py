"""Метрики дашборда (раздел 10.3): формулы и состав выборок."""
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from . import sla
from .models import Equipment, Ticket, User
from .security import Ctx
from .visibility import ticket_conditions

REPEAT_WINDOW_DAYS = 30


def base_query(ctx: Ctx, organization_id=None, site_id=None, equipment_type=None):
    q = select(Ticket).where(*ticket_conditions(ctx))
    if organization_id:
        q = q.where(Ticket.organization_id == organization_id)
    if site_id:
        q = q.where(Ticket.site_id == site_id)
    if equipment_type:
        q = q.where(Ticket.equipment_id.in_(select(Equipment.id).where(Equipment.type == equipment_type)))
    return q


def repeat_tickets(db: DbSession, sample: list[Ticket], window_days: int = REPEAT_WINDOW_DAYS) -> list[Ticket]:
    if not sample:
        return []
    eq_ids = {t.equipment_id for t in sample}
    closed = db.execute(select(Ticket.id, Ticket.equipment_id, Ticket.closed_at).where(
        Ticket.equipment_id.in_(eq_ids), Ticket.kind == "corrective", Ticket.status == "closed")).all()
    by_eq: dict = {}
    for pid, eid, closed_at in closed:
        by_eq.setdefault(eid, []).append((pid, closed_at))
    out = []
    for t in sample:
        for pid, closed_at in by_eq.get(t.equipment_id, []):
            if pid != t.id and closed_at is not None:
                d = t.created_at - closed_at
                if timedelta(0) <= d <= timedelta(days=window_days):
                    out.append(t)
                    break
    return out


def metric_sets(db: DbSession, ctx: Ctx, now: datetime, date_from: datetime, date_to: datetime,
                organization_id=None, site_id=None, equipment_type=None) -> dict:
    base = list(db.scalars(base_query(ctx, organization_id, site_id, equipment_type)))
    period = [t for t in base if date_from <= t.created_at <= date_to]
    active = [t for t in base if t.status in sla.ACTIVE]
    overdue = [t for t in active if sla.overdue_kind(t, now)]
    reaction = [t for t in period if t.first_reacted_at is not None and t.status not in sla.SLA_EXCLUDED]
    completion = [t for t in period if t.completed_consumed_seconds is not None
                  and t.status in ("awaiting_confirmation", "closed")]
    on_time = [t for t in completion if t.resolved_within_sla]
    corrective = [t for t in period if t.kind == "corrective" and t.status not in sla.SLA_EXCLUDED]
    repeat = repeat_tickets(db, corrective)
    return {"all": base, "period": period, "active": active, "overdue": overdue, "reaction": reaction,
            "completion": completion, "on_time": on_time, "corrective": corrective, "repeat": repeat,
            "awaiting_reaction": [t for t in period if t.status == "new"]}


def engineer_loads(db: DbSession, ctx: Ctx) -> list[dict]:
    q = select(User).where(User.role == "engineer", User.is_active.is_(True)).order_by(User.full_name)
    if ctx.role == "engineer":
        q = q.where(User.id == ctx.user.id)
    out = []
    for e in db.scalars(q):
        n = db.scalar(select(func.count()).select_from(Ticket).where(
            Ticket.assigned_engineer_id == e.id, Ticket.status.in_(["assigned", "in_progress", "paused"])))
        out.append({"engineer_id": e.id, "full_name": e.full_name, "capacity": e.capacity, "load": n,
                    "load_pct": round(100 * n / e.capacity, 1)})
    return out


def summary(db: DbSession, ctx: Ctx, now: datetime, date_from: datetime, date_to: datetime, **flt) -> dict:
    s = metric_sets(db, ctx, now, date_from, date_to, **flt)
    by_status = Counter(t.status for t in s["period"])
    by_prio = Counter(t.priority for t in s["active"])
    od = Counter(sla.overdue_kind(t, now) for t in s["overdue"])
    rc = s["reaction"]
    cm = s["completion"]
    res = {
        "period": {"from": date_from, "to": date_to, "generated_at": now},
        "tickets_total": len(s["period"]),
        "by_status": {k: by_status.get(k, 0) for k in
                      ["new", "accepted", "assigned", "in_progress", "paused", "awaiting_confirmation", "closed", "rejected", "cancelled"]},
        "active": {"count": len(s["active"]), "by_priority": {k: by_prio.get(k, 0) for k in ["critical", "high", "normal", "low"]}},
        "overdue": {"count": len(s["overdue"]), "resolution": od.get("resolution", 0) + od.get("both", 0),
                    "reaction": od.get("reaction", 0) + od.get("both", 0)},
        "awaiting_reaction": len(s["awaiting_reaction"]),
        "reaction": {"avg_seconds": round(sum((t.first_reacted_at - t.created_at).total_seconds() for t in rc) / len(rc)) if rc else None,
                     "sample": len(rc)},
        "completion": {"avg_seconds": round(sum(t.completed_consumed_seconds for t in cm) / len(cm)) if cm else None,
                       "sample": len(cm)},
        "on_time": {"count": len(s["on_time"]), "sample": len(cm),
                    "pct": round(100 * len(s["on_time"]) / len(cm), 1) if cm else None},
        "repeat_failures": {"window_days": REPEAT_WINDOW_DAYS, "count": len(s["repeat"]),
                            "corrective_total": len(s["corrective"]),
                            "pct": round(100 * len(s["repeat"]) / len(s["corrective"]), 1) if s["corrective"] else None},
        "closed_in_period": sum(1 for t in s["period"] if t.status == "closed"),
    }
    if ctx.role != "client":
        res["engineer_load"] = engineer_loads(db, ctx)
    return res
