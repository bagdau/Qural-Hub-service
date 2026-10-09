"""Часы SLA (раздел 10). Календарное время, часы идут в статусах RUNNING."""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .models import SlaPolicy, Ticket

RUNNING = {"new", "accepted", "assigned", "in_progress"}
ACTIVE = {"new", "accepted", "assigned", "in_progress", "paused", "awaiting_confirmation"}
TERMINAL = {"closed", "rejected", "cancelled"}
SLA_EXCLUDED = {"rejected", "cancelled"}

DEFAULT_POLICY = {
    "critical": (60, 480),
    "high": (240, 1440),
    "normal": (480, 4320),
    "low": (1440, 10080),
}


def load_policy(db: DbSession) -> dict[str, tuple[int, int]]:
    rows = db.scalars(select(SlaPolicy)).all()
    pol = {r.priority: (r.reaction_minutes, r.resolution_minutes) for r in rows}
    for k, v in DEFAULT_POLICY.items():
        pol.setdefault(k, v)
    return pol


def init_ticket(t: Ticket, policy: dict, now: datetime) -> None:
    r, s = policy[t.priority]
    t.sla_reaction_limit_seconds = r * 60
    t.sla_resolution_limit_seconds = s * 60
    t.reaction_due_at = t.created_at + timedelta(seconds=r * 60)
    t.sla_consumed_seconds = 0
    t.sla_clock_started_at = t.created_at
    recompute_due(t)


def consumed_now(t: Ticket, now: datetime) -> int:
    c = t.sla_consumed_seconds or 0
    if t.sla_clock_started_at is not None:
        c += max(0, int((now - t.sla_clock_started_at).total_seconds()))
    return c


def recompute_due(t: Ticket) -> None:
    if t.sla_clock_started_at is not None:
        remaining = t.sla_resolution_limit_seconds - (t.sla_consumed_seconds or 0)
        t.sla_due_at = t.sla_clock_started_at + timedelta(seconds=remaining)
    else:
        t.sla_due_at = None


def transition(t: Ticket, new_status: str, now: datetime) -> None:
    """Вызывать вместо прямого присвоения t.status."""
    if t.status in RUNNING and t.sla_clock_started_at is not None:
        t.sla_consumed_seconds = (t.sla_consumed_seconds or 0) + max(0, int((now - t.sla_clock_started_at).total_seconds()))
    t.sla_clock_started_at = now if new_status in RUNNING else None
    t.status = new_status
    recompute_due(t)


def mark_completed(t: Ticket) -> None:
    t.completed_consumed_seconds = t.sla_consumed_seconds
    t.resolved_within_sla = t.completed_consumed_seconds <= t.sla_resolution_limit_seconds


def change_priority(t: Ticket, new_priority: str, policy: dict) -> None:
    r, s = policy[new_priority]
    t.priority = new_priority
    t.sla_resolution_limit_seconds = s * 60
    t.sla_reaction_limit_seconds = r * 60
    if t.first_reacted_at is None:
        t.reaction_due_at = t.created_at + timedelta(seconds=r * 60)
    recompute_due(t)


def overdue_kind(t: Ticket, now: datetime) -> str | None:
    """'reaction' | 'resolution' | 'both' | None (метрика 2)."""
    if t.status in ("awaiting_confirmation",) or t.status in TERMINAL:
        return None
    res = t.status in ("new", "accepted", "assigned", "in_progress", "paused") and \
        consumed_now(t, now) > t.sla_resolution_limit_seconds
    rea = t.status == "new" and now > t.reaction_due_at
    if res and rea:
        return "both"
    if res:
        return "resolution"
    if rea:
        return "reaction"
    return None


def sla_view(t: Ticket, now: datetime, full: bool = True) -> dict:
    d = {
        "clock_running": t.sla_clock_started_at is not None,
        "due_at": t.sla_due_at,
        "is_overdue": overdue_kind(t, now) is not None,
        "overdue_kind": overdue_kind(t, now),
    }
    if full:
        d.update({
            "reaction_limit_seconds": t.sla_reaction_limit_seconds,
            "resolution_limit_seconds": t.sla_resolution_limit_seconds,
            "reaction_due_at": t.reaction_due_at,
            "first_reacted_at": t.first_reacted_at,
            "consumed_seconds": consumed_now(t, now),
            "resolved_within_sla": t.resolved_within_sla,
        })
    return d
