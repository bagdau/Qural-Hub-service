"""Единая политика области видимости (раздел 4.3)."""
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session as DbSession

from .errors import not_found
from .models import Assignment, Equipment, Site, Organization, Ticket
from .security import Ctx, audit_isolated

SERVICE_FULL = ("admin", "dispatcher", "manager")


def ticket_conditions(ctx: Ctx) -> list:
    u = ctx.user
    if u.role == "client":
        return [Ticket.organization_id == u.organization_id]
    if u.role == "engineer":
        return [exists().where(
            Assignment.ticket_id == Ticket.id, Assignment.engineer_id == u.id,
            or_(Assignment.ended_at.is_(None), Assignment.end_reason == "completed"))]
    return []


def tickets_select(ctx: Ctx):
    return select(Ticket).where(*ticket_conditions(ctx))


def get_ticket(db: DbSession, ctx: Ctx, ticket_id, for_update: bool = False) -> Ticket:
    q = select(Ticket).where(Ticket.id == ticket_id, *ticket_conditions(ctx))
    if for_update:
        q = q.with_for_update()
    t = db.scalar(q)
    if not t:
        if ctx.role in ("client", "engineer"):
            audit_isolated("access_denied", user=ctx.user, object_type="ticket", object_id=ticket_id)
        raise not_found()
    return t


def equipment_conditions(ctx: Ctx) -> list:
    u = ctx.user
    if u.role == "client":
        return [Equipment.organization_id == u.organization_id]
    if u.role == "engineer":
        return [Equipment.id.in_(select(Ticket.equipment_id).where(*ticket_conditions(ctx)))]
    return []


def get_equipment(db: DbSession, ctx: Ctx, equipment_id, for_update: bool = False) -> Equipment:
    q = select(Equipment).where(Equipment.id == equipment_id, *equipment_conditions(ctx))
    if for_update:
        q = q.with_for_update()
    e = db.scalar(q)
    if not e:
        if ctx.role in ("client", "engineer"):
            audit_isolated("access_denied", user=ctx.user, object_type="equipment", object_id=equipment_id)
        raise not_found()
    return e


def org_conditions(ctx: Ctx) -> list:
    if ctx.role == "client":
        return [Organization.id == ctx.user.organization_id]
    if ctx.role == "engineer":
        return [Organization.id.in_(select(Ticket.organization_id).where(*ticket_conditions(ctx))) |
                (Organization.kind == "service")]
    return []


def site_conditions(ctx: Ctx) -> list:
    if ctx.role == "client":
        return [Site.organization_id == ctx.user.organization_id]
    if ctx.role == "engineer":
        return [Site.id.in_(select(Ticket.site_id).where(*ticket_conditions(ctx)))]
    return []
