"""Жизненный цикл заявки (раздел 5): единственное место, где меняется статус."""
import logging
from datetime import datetime, timedelta

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session as DbSession

from . import acts as acts_mod
from . import clock, notifications, realtime, sla, storage
from .errors import ApiError, conflict, field_error, forbidden
from .execution import completion_check, current_report, draft_report, ensure_draft
from .models import (Act, Assignment, Equipment, MaintenancePlan, Organization, Ticket, TicketEvent, User, WorkReport)
from .security import Ctx
from .serializers import ACTION_SPEC, action_allowed, allowed_actions
from .visibility import get_equipment, get_ticket

log = logging.getLogger("workflow")
URGENCY_PRIORITY = {"planned": "normal", "urgent": "high", "emergency": "critical"}


# ---------------- события ----------------
def add_event(db: DbSession, t: Ticket, etype: str, at: datetime, *, actor: User | None = None, request_id=None,
              from_status=None, to_status=None, comment=None, payload=None, visibility="public") -> None:
    db.add(TicketEvent(ticket_id=t.id, event_type=etype, visibility=visibility,
                       actor_user_id=actor.id if actor else None, actor_role=actor.role if actor else None,
                       from_status=from_status, to_status=to_status, comment=comment, payload=jsonable_encoder(payload or {}),
                       request_id=request_id, created_at=at))
    prev = (payload or {}).get("from") if etype == "reassigned" else None
    realtime.notify(db, t, etype, visibility, [prev] if prev else [])


def next_number(db: DbSession, year: int) -> str:
    n = db.execute(text("INSERT INTO number_counters(year, last_value) VALUES (:y, 1) "
                        "ON CONFLICT (year) DO UPDATE SET last_value = number_counters.last_value + 1 "
                        "RETURNING last_value"), {"y": year}).scalar_one()
    return f"SR-{year}-{n:04d}"


def engineer_load(db: DbSession, engineer_id) -> int:
    return db.scalar(select(func.count()).select_from(Ticket).where(
        Ticket.assigned_engineer_id == engineer_id, Ticket.status.in_(["assigned", "in_progress", "paused"]))) or 0


# ---------------- создание ----------------
def create_ticket_core(db: DbSession, eq: Equipment, *, title, description, urgency, priority, kind, source,
                       created_by: User | None, now: datetime, contact_name=None, contact_phone=None,
                       related_ticket_id=None, plan: MaintenancePlan | None = None, plan_due_date=None,
                       request_id=None, number: str | None = None, notify: bool = True, ticket_id=None) -> Ticket:
    t = Ticket(
        **({"id": ticket_id} if ticket_id else {}),
        number=number or next_number(db, now.year), organization_id=eq.organization_id, equipment_id=eq.id,
        site_id=eq.site_id, kind=kind, source=source, plan_id=plan.id if plan else None, plan_due_date=plan_due_date,
        title=title, description=description, urgency=urgency, priority=priority, status="new",
        created_by=created_by.id if created_by else None, contact_name=contact_name, contact_phone=contact_phone,
        related_ticket_id=related_ticket_id, created_at=now, updated_at=now, version=1)
    sla.init_ticket(t, sla.load_policy(db), now)
    db.add(t)
    db.flush()
    add_event(db, t, "created", now, actor=created_by, request_id=request_id, to_status="new",
              payload={"source": source, "priority": priority})
    if notify:
        notifications.emit(db, "ticket_created", t, now, actor_id=created_by.id if created_by else None)
    return t


def create_ticket(db: DbSession, ctx: Ctx, data) -> tuple[Ticket, list]:
    now = clock.now()
    if ctx.role not in ("client", "dispatcher"):
        raise forbidden()
    eq = get_equipment(db, ctx, data.equipment_id)
    if eq.archived_at is not None:
        raise conflict("EQUIPMENT_ARCHIVED", "Оборудование в архиве — создать заявку нельзя.")
    org = db.get(Organization, eq.organization_id)
    if org.archived_at is not None:
        raise conflict("ORGANIZATION_ARCHIVED", "Организация в архиве.")
    if data.related_ticket_id:
        rel = db.get(Ticket, data.related_ticket_id)
        if not rel or rel.equipment_id != eq.id:
            raise field_error("related_ticket_id", "invalid", "Связанная заявка должна быть по тому же оборудованию.")
    active = db.scalar(select(Ticket).where(
        Ticket.equipment_id == eq.id, Ticket.kind == "corrective", Ticket.status.in_(list(sla.ACTIVE)))
        .order_by(Ticket.created_at.desc()).limit(1))
    contact_name = data.contact_name or (ctx.user.full_name if ctx.role == "client" else None)
    contact_phone = data.contact_phone or (ctx.user.phone if ctx.role == "client" else None)
    t = create_ticket_core(
        db, eq, title=data.title, description=data.description, urgency=data.urgency,
        priority=URGENCY_PRIORITY[data.urgency], kind="corrective", source="web" if ctx.role == "client" else "phone",
        created_by=ctx.user, now=now, contact_name=contact_name, contact_phone=contact_phone,
        related_ticket_id=data.related_ticket_id, request_id=ctx.request_id)
    warnings = []
    if active:
        warnings.append({"code": "ACTIVE_TICKET_EXISTS",
                         "message": f"По этому оборудованию уже есть активная заявка {active.number}.",
                         "details": {"ticket_id": str(active.id), "number": active.number}})
    return t, warnings


# ---------------- применение действий ----------------
def apply_action(db: DbSession, ctx: Ctx, ticket_id, action: str, body) -> tuple[Ticket, list]:
    now = clock.now()
    t = get_ticket(db, ctx, ticket_id, for_update=True)
    spec = ACTION_SPEC[action]
    if ctx.role not in spec:
        raise forbidden()
    if ctx.role == "engineer" and t.assigned_engineer_id != ctx.user.id:
        raise forbidden("Заявка назначена другому инженеру.")
    if body.version != t.version:
        raise ApiError(409, "VERSION_CONFLICT", "Заявка была изменена другим пользователем. "
                       "Обновите данные и повторите действие.",
                       {"current_version": t.version, "sent_version": body.version,
                        "current_state": {"status": t.status, "updated_at": t.updated_at,
                                          "assigned_engineer": ({"id": str(t.assigned_engineer_id)}
                                                                if t.assigned_engineer_id else None)}})
    if not action_allowed(action, t, ctx):
        raise ApiError(409, "INVALID_TRANSITION", f"Действие недоступно в статусе «{t.status}».",
                       {"status": t.status, "allowed_actions": allowed_actions(t, ctx)})
    warnings: list = []
    old_status = t.status
    handler = globals()[f"_do_{action}"]
    handler(db, ctx, t, body, now, warnings)
    t.version += 1
    t.updated_at = now
    db.flush()
    return t, warnings


def _check_engineer(db: DbSession, engineer_id) -> User:
    e = db.get(User, engineer_id)
    if not e or e.role != "engineer" or not e.is_active:
        raise ApiError(422, "ASSIGNEE_NOT_AVAILABLE", "Выбранный пользователь не может быть назначен исполнителем.")
    return e


def _set_priority(db, t, new, now, ctx, reason=None):
    if new != t.priority:
        old = t.priority
        sla.change_priority(t, new, sla.load_policy(db))
        add_event(db, t, "priority_changed", now, actor=ctx.user, request_id=ctx.request_id, visibility="internal",
                  comment=reason, payload={"from": old, "to": new})


def _do_accept(db, ctx, t, b, now, warnings):
    _set_priority(db, t, b.priority, now, ctx, "Подтверждение приоритета при принятии")
    frm = t.status
    t.first_reacted_at = now
    t.accepted_at = now
    sla.transition(t, "accepted", now)
    add_event(db, t, "accepted", now, actor=ctx.user, request_id=ctx.request_id, from_status=frm, to_status="accepted",
              payload={"priority": t.priority})
    notifications.emit(db, "ticket_accepted", t, now, actor_id=ctx.user.id)


def _do_reject(db, ctx, t, b, now, warnings):
    frm = t.status
    t.first_reacted_at = t.first_reacted_at or now
    t.rejected_at = now
    sla.transition(t, "rejected", now)
    add_event(db, t, "rejected", now, actor=ctx.user, request_id=ctx.request_id, from_status=frm, to_status="rejected",
              comment=b.comment, payload={"reason_code": b.reason_code,
                                          "duplicate_of": str(b.duplicate_of_ticket_id) if b.duplicate_of_ticket_id else None})
    notifications.emit(db, "ticket_rejected", t, now, actor_id=ctx.user.id)


def _new_assignment(db, t, eng: User, ctx, now, scheduled_at, comment):
    db.add(Assignment(ticket_id=t.id, engineer_id=eng.id, assigned_by=ctx.user.id, assigned_at=now,
                      scheduled_at=scheduled_at, comment=comment))
    t.assigned_engineer_id = eng.id
    if scheduled_at:
        t.scheduled_at = scheduled_at


def _do_assign(db, ctx, t, b, now, warnings):
    eng = _check_engineer(db, b.engineer_id)
    if t.status == "new":
        if not b.priority:
            raise field_error("priority", "required", "Подтвердите приоритет при принятии заявки.")
        _do_accept(db, ctx, t, type("B", (), {"priority": b.priority})(), now, warnings)
    load = engineer_load(db, eng.id)
    if load >= eng.capacity:
        warnings.append({"code": "ENGINEER_OVERLOADED",
                         "message": f"Загрузка инженера {eng.full_name}: {load} из {eng.capacity}."})
    frm = t.status
    _new_assignment(db, t, eng, ctx, now, b.scheduled_at, b.comment)
    sla.transition(t, "assigned", now)
    add_event(db, t, "assigned", now, actor=ctx.user, request_id=ctx.request_id, from_status=frm, to_status="assigned",
              comment=b.comment, payload={"engineer_id": str(eng.id), "engineer_name": eng.full_name,
                                          "scheduled_at": b.scheduled_at})
    notifications.emit(db, "ticket_assigned", t, now, actor_id=ctx.user.id, to=[eng.id])
    notifications.emit(db, "ticket_assigned", t, now, actor_id=ctx.user.id, to=notifications.client_recipients(db, t),
                       body=f"Назначен инженер: {eng.full_name}")


def _do_reassign(db, ctx, t, b, now, warnings):
    if b.engineer_id == t.assigned_engineer_id:
        raise ApiError(422, "SAME_ASSIGNEE", "Выбран тот же инженер.")
    eng = _check_engineer(db, b.engineer_id)
    old = db.get(User, t.assigned_engineer_id)
    cur = db.scalar(select(Assignment).where(Assignment.ticket_id == t.id, Assignment.ended_at.is_(None)))
    cur.ended_at, cur.end_reason = now, "reassigned"
    db.flush()
    _new_assignment(db, t, eng, ctx, now, None, None)
    load = engineer_load(db, eng.id)
    if load >= eng.capacity:
        warnings.append({"code": "ENGINEER_OVERLOADED", "message": f"Загрузка инженера {eng.full_name}: {load} из {eng.capacity}."})
    frm = t.status
    if t.status == "in_progress":
        sla.transition(t, "assigned", now)
    d = draft_report(db, t.id)
    if d:
        d.author_id = eng.id
    add_event(db, t, "reassigned", now, actor=ctx.user, request_id=ctx.request_id, from_status=frm, to_status=t.status,
              comment=b.reason, payload={"from": str(old.id), "from_name": old.full_name, "to": str(eng.id),
                                         "to_name": eng.full_name, "reason": b.reason})
    notifications.emit(db, "ticket_unassigned", t, now, actor_id=ctx.user.id, to=[old.id])
    notifications.emit(db, "ticket_assigned", t, now, actor_id=ctx.user.id, to=[eng.id])


def _do_start(db, ctx, t, b, now, warnings):
    frm = t.status
    ensure_draft(db, t, ctx.user.id, now)
    t.started_at = t.started_at or now
    sla.transition(t, "in_progress", now)
    add_event(db, t, "started", now, actor=ctx.user, request_id=ctx.request_id, from_status=frm, to_status="in_progress")
    notifications.emit(db, "ticket_started", t, now, actor_id=ctx.user.id)


def _do_pause(db, ctx, t, b, now, warnings):
    if b.expected_resume_at <= now:
        raise field_error("expected_resume_at", "in_past", "Ожидаемая дата возобновления должна быть в будущем.")
    t.pause_reason_code, t.pause_comment = b.reason_code, b.comment
    t.pause_next_action, t.pause_expected_resume_at = b.next_action, b.expected_resume_at
    sla.transition(t, "paused", now)
    add_event(db, t, "paused", now, actor=ctx.user, request_id=ctx.request_id, from_status="in_progress",
              to_status="paused", comment=b.comment,
              payload={"reason_code": b.reason_code, "next_action": b.next_action,
                       "expected_resume_at": b.expected_resume_at})
    notifications.emit(db, "ticket_paused", t, now, actor_id=ctx.user.id)


def _do_resume(db, ctx, t, b, now, warnings):
    paused_at = db.scalar(select(TicketEvent.created_at).where(
        TicketEvent.ticket_id == t.id, TicketEvent.event_type == "paused").order_by(TicketEvent.id.desc()).limit(1))
    t.pause_reason_code = t.pause_comment = t.pause_next_action = t.pause_expected_resume_at = None
    sla.transition(t, "in_progress", now)
    add_event(db, t, "resumed", now, actor=ctx.user, request_id=ctx.request_id, from_status="paused",
              to_status="in_progress", comment=b.comment,
              payload={"paused_seconds": int((now - paused_at).total_seconds()) if paused_at else None})
    notifications.emit(db, "ticket_resumed", t, now, actor_id=ctx.user.id)


def _do_complete(db, ctx, t, b, now, warnings):
    r = draft_report(db, t.id, for_update=True)
    failed = completion_check(db, t, r)
    if failed:
        raise ApiError(422, "COMPLETION_REQUIREMENTS_NOT_MET",
                       "Нельзя завершить заявку: не выполнены обязательные условия.", {"failed_checks": failed})
    key = None
    try:
        r.status, r.submitted_at, r.updated_at = "submitted", now, now
        r.version += 1
        db.flush()
        sla.transition(t, "awaiting_confirmation", now)
        sla.mark_completed(t)
        t.completed_at = now
        act, key = acts_mod.generate(db, t, r, ctx.user, now)
        add_event(db, t, "completed", now, actor=ctx.user, request_id=ctx.request_id, from_status="in_progress",
                  to_status="awaiting_confirmation",
                  payload={"report_revision": r.revision, "consumed_seconds": t.completed_consumed_seconds})
        add_event(db, t, "act_generated", now, actor=ctx.user, request_id=ctx.request_id,
                  payload={"act_id": str(act.id), "version": act.version, "number": act.number})
        notifications.emit(db, "ticket_awaiting_confirmation", t, now, actor_id=ctx.user.id)
    except Exception:
        storage.delete(key)
        raise


def _current_act(db, t, act_id) -> Act:
    act = db.scalar(select(Act).where(Act.ticket_id == t.id, Act.is_current.is_(True)).with_for_update())
    if not act or act.id != act_id:
        raise ApiError(409, "ACT_OUTDATED", "Этот акт больше не актуален: по заявке сформирована новая версия.",
                       {"sent_act_id": str(act_id), "current_act_id": str(act.id) if act else None,
                        "current_version": act.version if act else None})
    return act


def _do_confirm(db, ctx, t, b, now, warnings):
    act = _current_act(db, t, b.act_id)
    act.decision, act.decided_by, act.decided_at = "confirmed", ctx.user.id, now
    act.decision_comment, act.rating = b.comment, b.rating
    sla.transition(t, "closed", now)
    t.closed_at = now
    cur = db.scalar(select(Assignment).where(Assignment.ticket_id == t.id, Assignment.ended_at.is_(None)))
    if cur:
        cur.ended_at, cur.end_reason = now, "completed"
    if t.plan_id:
        plan = db.get(MaintenancePlan, t.plan_id)
        site_tz = _site_tz(db, t)
        done = now.astimezone(site_tz).date()
        plan.last_done_on = done
        plan.next_due_date = done + timedelta(days=plan.interval_days)
        plan.version += 1
    add_event(db, t, "confirmed", now, actor=ctx.user, request_id=ctx.request_id, from_status="awaiting_confirmation",
              to_status="closed", comment=b.comment, payload={"act_id": str(act.id), "rating": b.rating})
    notifications.emit(db, "ticket_closed", t, now, actor_id=ctx.user.id)


def _site_tz(db, t):
    from zoneinfo import ZoneInfo
    from .models import Site
    try:
        return ZoneInfo(db.get(Site, t.site_id).timezone)
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def _do_return(db, ctx, t, b, now, warnings):
    act = _current_act(db, t, b.act_id)
    act.decision, act.decided_by, act.decided_at = "returned", ctx.user.id, now
    act.decision_comment = b.comment
    act.is_current, act.superseded_at = False, now
    rep = current_report(db, t.id, for_update=True)
    rep.status = "superseded"
    db.flush()
    from .execution import clone_report
    new = clone_report(db, t, rep, t.assigned_engineer_id, now)
    new.photo_exception_status = "none"
    t.return_count += 1
    t.completed_at = None
    sla.transition(t, "in_progress", now)
    add_event(db, t, "returned", now, actor=ctx.user, request_id=ctx.request_id, from_status="awaiting_confirmation",
              to_status="in_progress", comment=b.comment, payload={"act_id": str(act.id)})
    notifications.emit(db, "ticket_returned", t, now, actor_id=ctx.user.id)


def _do_cancel(db, ctx, t, b, now, warnings):
    if ctx.role == "dispatcher" and t.status in ("in_progress", "paused") and len(b.reason) < 10:
        raise field_error("reason", "too_short", "Для отмены работ в процессе укажите причину (не менее 10 символов).")
    frm = t.status
    t.pause_reason_code = t.pause_comment = t.pause_next_action = t.pause_expected_resume_at = None
    cur = db.scalar(select(Assignment).where(Assignment.ticket_id == t.id, Assignment.ended_at.is_(None)))
    if cur:
        cur.ended_at, cur.end_reason = now, "ticket_cancelled"
    t.cancelled_at = now
    sla.transition(t, "cancelled", now)
    add_event(db, t, "cancelled", now, actor=ctx.user, request_id=ctx.request_id, from_status=frm, to_status="cancelled",
              comment=b.reason)
    if ctx.role == "client":
        notifications.emit(db, "ticket_cancelled", t, now, actor_id=ctx.user.id,
                           to=notifications.recipients(db, "ticket_created", t) + ([t.assigned_engineer_id] if t.assigned_engineer_id else []))
    else:
        notifications.emit(db, "ticket_cancelled", t, now, actor_id=ctx.user.id,
                           to=([t.assigned_engineer_id] if t.assigned_engineer_id else []) + notifications.client_recipients(db, t))


def _do_priority(db, ctx, t, b, now, warnings):
    if b.priority == t.priority:
        raise field_error("priority", "same", "Приоритет не изменился.")
    _set_priority(db, t, b.priority, now, ctx, b.reason)
