from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DbSession

from .. import clock, idempotency
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError, conflict, field_error, not_found
from ..models import Assignment, Organization, Ticket, User
from ..schemas import UserCreate, UserPatch, VersionIn
from ..security import (EMAIL_RE, Ctx, audit, generate_temp_password, get_ctx, hash_password, require,
                        revoke_user_sessions)
from ..serializers import page_of
from .auth import user_out
from .common import Page, apply_sort, paginate, strict_params, version_check
from datetime import timedelta

router = APIRouter(tags=["users"])


def _check_role_org(db: DbSession, role: str, org_id):
    org = db.get(Organization, org_id)
    if not org:
        raise field_error("organization_id", "not_found", "Организация не найдена.")
    if (role == "client") != (org.kind == "client"):
        raise field_error("organization_id", "role_org_mismatch",
                          "Клиент должен принадлежать клиентской организации, сотрудники — сервисной.")
    return org


@router.get("/users")
def list_users(request: Request, role: str | None = None, organization_id: str | None = None,
               is_active: bool | None = None, q: str | None = None, sort: str | None = None,
               pg: Page = Depends(), ctx: Ctx = Depends(require("admin", "manager", "dispatcher")),
               db: DbSession = Depends(get_db, scope="function")):
    strict_params(request, {"role", "organization_id", "is_active", "q"})
    qy = select(User)
    if ctx.role == "dispatcher":
        qy = qy.where(User.role.in_(["engineer", "client"]))
    if role:
        qy = qy.where(User.role == role)
    if organization_id:
        qy = qy.where(User.organization_id == organization_id)
    if is_active is not None:
        qy = qy.where(User.is_active == is_active)
    if q:
        like = f"%{q}%"
        qy = qy.where(or_(User.full_name.ilike(like), User.email.ilike(like)))
    qy = apply_sort(qy, sort, {"full_name": User.full_name, "email": User.email, "created_at": User.created_at,
                               "role": User.role}, [User.full_name, User.id])
    rows, total = paginate(db, qy, pg)
    return page_of([user_out(db, u) for u in rows], total, pg.page, pg.page_size)


@router.post("/users", status_code=201)
def create_user(body: UserCreate, request: Request, ctx: Ctx = Depends(require("admin")),
                db: DbSession = Depends(get_db, scope="function")):
    def go():
        if not EMAIL_RE.match(body.email):
            raise field_error("email", "invalid", "Некорректный email.")
        _check_role_org(db, body.role, body.organization_id)
        if db.scalar(select(User.id).where(func.lower(User.email) == body.email.lower())):
            raise conflict("DUPLICATE", "Пользователь с таким email уже существует.")
        s, now = get_settings(), clock.now()
        temp = generate_temp_password()
        u = User(organization_id=body.organization_id, email=body.email.lower(), full_name=body.full_name,
                 phone=body.phone, role=body.role, password_hash=hash_password(temp), must_change_password=True,
                 temp_password_expires_at=now + timedelta(hours=s.temp_password_ttl_hours), is_active=True,
                 capacity=body.capacity or 4, created_by=ctx.user.id, created_at=now, updated_at=now)
        db.add(u)
        db.flush()
        audit(db, "user_created", user=ctx.user, object_type="user", object_id=u.id, request=request,
              details={"role": u.role, "email": u.email})
        return 201, {"user": user_out(db, u), "temp_password": temp}
    return idempotency.run(db, ctx, request, body.model_dump(mode="json"), go)


@router.get("/users/{user_id}")
def get_user(user_id: str, ctx: Ctx = Depends(require("admin", "manager", "dispatcher")), db: DbSession = Depends(get_db, scope="function")):
    u = _get(db, user_id)
    if ctx.role == "dispatcher" and u.role not in ("engineer", "client"):
        raise not_found()
    return user_out(db, u)


def _get(db, user_id, lock=False) -> User:
    import uuid
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise not_found()
    q = select(User).where(User.id == uid)
    u = db.scalar(q.with_for_update() if lock else q)
    if not u:
        raise not_found()
    return u


@router.patch("/users/{user_id}")
def patch_user(user_id: str, body: UserPatch, request: Request, ctx: Ctx = Depends(require("admin")),
               db: DbSession = Depends(get_db, scope="function")):
    u = _get(db, user_id, True)
    version_check(u, body.version, "Пользователь")
    data = body.model_dump(exclude_unset=True, exclude={"version"})
    new_role = data.get("role", u.role)
    new_org = data.get("organization_id", u.organization_id)
    if "role" in data or "organization_id" in data:
        _check_role_org(db, new_role, new_org)
    for k, v in data.items():
        setattr(u, k, v)
    u.version += 1
    u.updated_at = clock.now()
    audit(db, "user_updated", user=ctx.user, object_type="user", object_id=u.id, request=request,
          details={"fields": sorted(data.keys())})
    return user_out(db, u)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")),
                   db: DbSession = Depends(get_db, scope="function")):
    def go():
        u = _get(db, user_id, True)
        version_check(u, body.version, "Пользователь")
        now, temp = clock.now(), generate_temp_password()
        u.password_hash, u.must_change_password = hash_password(temp), True
        u.temp_password_expires_at = now + timedelta(hours=get_settings().temp_password_ttl_hours)
        u.failed_login_count, u.locked_until = 0, None
        u.version += 1
        revoke_user_sessions(db, u.id, "admin")
        audit(db, "password_reset", user=ctx.user, object_type="user", object_id=u.id, request=request)
        return 200, {"temp_password": temp}
    return idempotency.run(db, ctx, request, {"id": user_id, **body.model_dump()}, go)


@router.post("/users/{user_id}/deactivate")
def deactivate(user_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")),
               db: DbSession = Depends(get_db, scope="function")):
    u = _get(db, user_id, True)
    version_check(u, body.version, "Пользователь")
    if u.id == ctx.user.id:
        raise conflict("SELF_DEACTIVATION", "Нельзя деактивировать самого себя.")
    if u.role == "admin":
        others = db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.is_active.is_(True), User.id != u.id))
        if not others:
            raise conflict("LAST_ADMIN_PROTECTED", "Нельзя деактивировать последнего активного администратора.")
    if u.role == "engineer":
        rows = db.execute(select(Ticket.id, Ticket.number).where(
            Ticket.assigned_engineer_id == u.id, Ticket.status.in_(["assigned", "in_progress", "paused", "awaiting_confirmation"]))).all()
        if rows:
            raise conflict("USER_HAS_ACTIVE_ASSIGNMENTS", "У инженера есть активные заявки — сначала переназначьте их.",
                           {"tickets": [{"id": str(i), "number": n} for i, n in rows]})
    now = clock.now()
    u.is_active, u.deactivated_at, u.version = False, now, u.version + 1
    revoke_user_sessions(db, u.id, "deactivated")
    audit(db, "user_deactivated", user=ctx.user, object_type="user", object_id=u.id, request=request)
    return user_out(db, u)


@router.post("/users/{user_id}/activate")
def activate(user_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")),
             db: DbSession = Depends(get_db, scope="function")):
    u = _get(db, user_id, True)
    version_check(u, body.version, "Пользователь")
    temp = generate_temp_password()
    now = clock.now()
    u.is_active, u.deactivated_at, u.must_change_password = True, None, True
    u.password_hash = hash_password(temp)
    u.temp_password_expires_at = now + timedelta(hours=get_settings().temp_password_ttl_hours)
    u.version += 1
    audit(db, "user_activated", user=ctx.user, object_type="user", object_id=u.id, request=request)
    return {"user": user_out(db, u), "temp_password": temp}


@router.post("/users/{user_id}/revoke-sessions", status_code=204)
def revoke(user_id: str, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    u = _get(db, user_id)
    n = revoke_user_sessions(db, u.id, "admin")
    audit(db, "sessions_revoked", user=ctx.user, object_type="user", object_id=u.id, request=request, details={"count": n})
    return Response(status_code=204)


@router.get("/engineers")
def engineers(available: bool = False, ctx: Ctx = Depends(require("admin", "dispatcher", "manager")),
              db: DbSession = Depends(get_db, scope="function")):
    from ..workflow import engineer_load
    out = []
    for e in db.scalars(select(User).where(User.role == "engineer", User.is_active.is_(True)).order_by(User.full_name)):
        load = engineer_load(db, e.id)
        out.append({"id": e.id, "full_name": e.full_name, "capacity": e.capacity, "load": load,
                    "load_pct": round(100 * load / e.capacity, 1)})
    if available:
        out = [o for o in out if o["load"] < o["capacity"]]
    return out
