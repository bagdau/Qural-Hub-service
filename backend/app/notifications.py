"""Уведомления внутри приложения (6.13). Создаются в транзакции действия."""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session as DbSession

from .models import Notification, Ticket, User


def _active_by_role(db: DbSession, role: str) -> list:
    return list(db.scalars(select(User.id).where(User.role == role, User.is_active.is_(True))))


def client_recipients(db: DbSession, t: Ticket) -> list:
    if t.created_by:
        creator = db.get(User, t.created_by)
        if creator and creator.role == "client" and creator.is_active:
            return [creator.id]
    return list(db.scalars(select(User.id).where(
        User.role == "client", User.organization_id == t.organization_id, User.is_active.is_(True))))


TITLES = {
    "ticket_created": "Новая заявка {n}",
    "ticket_accepted": "Заявка {n} принята",
    "ticket_rejected": "Заявка {n} отклонена",
    "ticket_assigned": "По заявке {n} назначен инженер",
    "ticket_unassigned": "Вы сняты с заявки {n}",
    "ticket_started": "Работы по заявке {n} начаты",
    "ticket_paused": "Заявка {n} приостановлена",
    "ticket_resumed": "Работы по заявке {n} возобновлены",
    "ticket_awaiting_confirmation": "Заявка {n}: работы завершены, подтвердите результат",
    "ticket_returned": "Заявка {n} возвращена на доработку",
    "ticket_closed": "Заявка {n} закрыта",
    "ticket_cancelled": "Заявка {n} отменена",
    "photo_exception_requested": "Заявка {n}: запрос исключения по фото",
    "photo_exception_decided": "Заявка {n}: решение по исключению по фото",
    "sla_breached": "Заявка {n}: срок выполнения превышен",
    "sla_reaction_breached": "Заявка {n}: срок реакции превышен",
    "pause_overdue": "Заявка {n}: пауза затянулась",
    "awaiting_reminder": "Заявка {n}: ждём вашего решения по акту",
    "plan_missed": "Плановая заявка {n} не выполнена",
}


def recipients(db: DbSession, ntype: str, t: Ticket) -> list:
    disp = lambda: _active_by_role(db, "dispatcher")  # noqa: E731
    mgr = lambda: _active_by_role(db, "manager")  # noqa: E731
    eng = [t.assigned_engineer_id] if t.assigned_engineer_id else []
    cl = lambda: client_recipients(db, t)  # noqa: E731
    m = {
        "ticket_created": disp, "ticket_accepted": cl, "ticket_rejected": cl,
        "ticket_started": cl, "ticket_paused": lambda: disp() + cl(), "ticket_resumed": lambda: disp() + cl(),
        "ticket_awaiting_confirmation": lambda: cl() + disp(),
        "ticket_returned": lambda: eng + disp(), "ticket_closed": lambda: eng + disp(),
        "sla_breached": lambda: disp() + mgr() + eng, "sla_reaction_breached": lambda: disp() + mgr(),
        "pause_overdue": disp, "awaiting_reminder": cl, "plan_missed": disp,
        "photo_exception_requested": disp, "photo_exception_decided": lambda: eng,
    }
    return m[ntype]() if ntype in m else []


def emit(db: DbSession, ntype: str, t: Ticket, at: datetime, *, actor_id=None, to=None,
         dedupe_key: str | None = None, body: str | None = None, payload: dict | None = None) -> int:
    ids = to if to is not None else recipients(db, ntype, t)
    seen, n = set(), 0
    for uid in ids:
        if uid is None or uid in seen or uid == actor_id:
            continue
        seen.add(uid)
        stmt = pg_insert(Notification).values(
            user_id=uid, type=ntype, title=TITLES[ntype].format(n=t.number), body=body or t.title,
            ticket_id=t.id, payload=payload or {}, dedupe_key=dedupe_key, created_at=at,
        )
        if dedupe_key:
            stmt = stmt.on_conflict_do_nothing(index_elements=["user_id", "dedupe_key"],
                                               index_where=Notification.dedupe_key.isnot(None))
        res = db.execute(stmt)
        n += res.rowcount or 0
    return n
