"""Фоновые задачи worker (идемпотентны). Раздел 6.12, 6.13, 10.5, 7.9."""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from . import notifications, sla, storage, workflow
from .models import (Act, Attachment, Equipment, IdempotencyKey, JobRun, MaintenancePlan, Notification, Session, Site,
                     Ticket)

log = logging.getLogger("jobs")
AWAITING_REMINDER_HOURS = 72


def generate_planned(db: DbSession, now: datetime) -> int:
    n = 0
    plans = db.scalars(select(MaintenancePlan).where(MaintenancePlan.is_active.is_(True)).with_for_update(skip_locked=True)).all()
    for p in plans:
        eq = db.get(Equipment, p.equipment_id)
        if eq.archived_at is not None:
            continue
        site = db.get(Site, eq.site_id)
        try:
            today = now.astimezone(ZoneInfo(site.timezone)).date()
        except Exception:  # noqa: BLE001
            today = now.date()
        if p.next_due_date - timedelta(days=p.lead_days) > today:
            continue
        if db.scalar(select(Ticket.id).where(Ticket.plan_id == p.id, Ticket.plan_due_date == p.next_due_date)):
            continue
        sp = db.begin_nested()
        try:
            workflow.create_ticket_core(
                db, eq, title=f"Плановое ТО: {p.title}", description=p.description or f"Плановые работы по графику: {p.title}.",
                urgency="planned", priority=p.priority, kind="planned", source="scheduler", created_by=None, now=now,
                plan=p, plan_due_date=p.next_due_date)
            sp.commit()
            n += 1
        except Exception:  # noqa: BLE001
            sp.rollback()
            log.exception("не удалось создать плановую заявку для плана %s", p.id)
    return n


def check_sla(db: DbSession, now: datetime) -> int:
    n = 0
    for t in db.scalars(select(Ticket).where(Ticket.status.in_(["new", "accepted", "assigned", "in_progress", "paused"]))):
        kind = sla.overdue_kind(t, now)
        if kind in ("resolution", "both"):
            at = t.sla_due_at if (t.sla_due_at and t.sla_due_at <= now) else now
            n += notifications.emit(db, "sla_breached", t, at, dedupe_key=f"sla_breach:{t.id}:{t.sla_resolution_limit_seconds}")
        if kind in ("reaction", "both"):
            n += notifications.emit(db, "sla_reaction_breached", t, t.reaction_due_at, dedupe_key=f"sla_reaction:{t.id}")
    return n


def pause_and_reminders(db: DbSession, now: datetime) -> int:
    n = 0
    for t in db.scalars(select(Ticket).where(Ticket.status == "paused", Ticket.pause_expected_resume_at < now)):
        n += notifications.emit(db, "pause_overdue", t, now,
                                dedupe_key=f"pause_overdue:{t.id}:{t.pause_expected_resume_at.isoformat()}")
    for t in db.scalars(select(Ticket).where(Ticket.status == "awaiting_confirmation",
                                             Ticket.completed_at <= now - timedelta(hours=AWAITING_REMINDER_HOURS))):
        n += notifications.emit(db, "awaiting_reminder", t, now, dedupe_key=f"awaiting_reminder:{t.id}:{t.completed_at.isoformat()}")
    return n


def cleanup(db: DbSession, now: datetime) -> dict:
    s = db.execute(delete(Session).where(Session.expires_at < now - timedelta(days=7))).rowcount
    nn = db.execute(delete(Notification).where(Notification.created_at < now - timedelta(days=90))).rowcount
    ik = db.execute(delete(IdempotencyKey).where(IdempotencyKey.expires_at < now)).rowcount
    return {"sessions": s, "notifications": nn, "idempotency": ik, "orphans": gc_orphans(db, now)}


def referenced_keys(db: DbSession) -> set[str]:
    keys = set()
    for k, tk in db.execute(select(Attachment.storage_key, Attachment.thumb_storage_key)):
        keys.add(k)
        if tk:
            keys.add(tk)
    keys.update(db.scalars(select(Act.storage_key)))
    return keys


def gc_orphans(db: DbSession, now: datetime) -> int:
    root = storage.root()
    if not root.exists():
        return 0
    refs, n = referenced_keys(db), 0
    cutoff = now - timedelta(hours=24)
    for sub in ("attachments", "thumbs", "acts"):
        d = root / sub
        if not d.exists():
            continue
        for f in d.rglob("*"):
            if f.is_file():
                key = f.relative_to(root).as_posix()
                if key not in refs and datetime.fromtimestamp(f.stat().st_mtime, tz=now.tzinfo) < cutoff:
                    f.unlink()
                    n += 1
    return n


def verify_storage(db: DbSession) -> dict:
    missing, bad_hash = [], []
    for a in db.scalars(select(Attachment).where(Attachment.deleted_at.is_(None))):
        if not storage.exists(a.storage_key):
            missing.append(a.storage_key)
        elif storage.sha256(storage.read(a.storage_key)) != a.sha256:
            bad_hash.append(a.storage_key)
    for a in db.scalars(select(Act)):
        if not storage.exists(a.storage_key):
            missing.append(a.storage_key)
        elif storage.sha256(storage.read(a.storage_key)) != a.sha256:
            bad_hash.append(a.storage_key)
    refs = referenced_keys(db)
    orphans = []
    root = storage.root()
    for sub in ("attachments", "thumbs", "acts"):
        d = root / sub
        if d.exists():
            orphans += [f.relative_to(root).as_posix() for f in d.rglob("*") if f.is_file()
                        and f.relative_to(root).as_posix() not in refs]
    return {"missing": missing, "hash_mismatch": bad_hash, "orphans": orphans}


def run_all(db: DbSession, now: datetime, include_cleanup: bool = False) -> dict:
    run = JobRun(job_name="periodic", started_at=now)
    db.add(run)
    db.flush()
    res = {"planned_created": generate_planned(db, now), "sla_notifications": check_sla(db, now),
           "reminders": pause_and_reminders(db, now)}
    if include_cleanup:
        res["cleanup"] = cleanup(db, now)
    run.finished_at, run.status, run.details = now, "ok", res
    return res
