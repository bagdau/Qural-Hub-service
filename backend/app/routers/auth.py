from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .. import clock
from ..config import get_settings
from ..db import SessionLocal, get_db
from ..errors import ApiError, not_found
from ..models import Organization, Session, User
from ..schemas import ChangePasswordIn, LoginIn
from ..security import (COOKIE, Ctx, audit, create_session, csrf_for, get_ctx, hash_password, revoke_user_sessions,
                        validate_password, verify_password)

router = APIRouter(prefix="/auth", tags=["auth"])
_DUMMY = hash_password("dummy-password-for-timing")

PERMISSIONS = {
    "admin": ["users", "organizations", "equipment", "tickets:view", "spare_parts", "checklists", "sla", "analytics", "audit", "maintenance"],
    "dispatcher": ["equipment", "tickets:view", "tickets:create", "tickets:manage", "spare_parts", "analytics", "maintenance", "users:view"],
    "engineer": ["equipment:view", "tickets:work", "my_tasks"],
    "manager": ["equipment", "tickets:view", "analytics", "users:view", "maintenance"],
    "client": ["equipment", "tickets:view", "tickets:create", "tickets:confirm", "analytics", "maintenance"],
}


def user_out(db: DbSession, u: User) -> dict:
    org = db.get(Organization, u.organization_id)
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "phone": u.phone, "role": u.role,
            "organization": {"id": org.id, "name": org.name, "kind": org.kind}, "is_active": u.is_active,
            "capacity": u.capacity if u.role == "engineer" else None,
            "must_change_password": u.must_change_password, "last_login_at": u.last_login_at,
            "created_at": u.created_at, "version": u.version}


@router.post("/login")
def login(body: LoginIn, request: Request):
    s = get_settings()
    db = SessionLocal()
    try:
        now = clock.now()
        user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
        if not user or not user.is_active:
            verify_password(_DUMMY, body.password)
            audit(db, "login_failed", request=request, details={"email": body.email[:100]})
            db.commit()
            raise ApiError(401, "INVALID_CREDENTIALS", "Неверный email или пароль.")
        if user.locked_until and user.locked_until > now:
            raise ApiError(423, "ACCOUNT_LOCKED", "Вход временно заблокирован из-за неудачных попыток.",
                           {"locked_until": user.locked_until})
        org = db.get(Organization, user.organization_id)
        expired = user.must_change_password and user.temp_password_expires_at and user.temp_password_expires_at < now
        if not verify_password(user.password_hash, body.password) or expired or \
                (org.archived_at is not None and user.role == "client"):
            user.failed_login_count += 1
            audit(db, "login_failed", user=user, request=request)
            if user.failed_login_count >= s.login_max_failures:
                user.locked_until = now + timedelta(minutes=s.login_lock_minutes)
                user.failed_login_count = 0
                audit(db, "account_locked", user=user, request=request)
                db.commit()
                raise ApiError(423, "ACCOUNT_LOCKED", "Вход временно заблокирован из-за неудачных попыток.",
                               {"locked_until": user.locked_until})
            db.commit()
            raise ApiError(401, "INVALID_CREDENTIALS", "Неверный email или пароль.")
        user.failed_login_count, user.locked_until, user.last_login_at = 0, None, now
        token = create_session(db, user, request)
        audit(db, "login_success", user=user, request=request)
        db.commit()
        out = {"user": user_out(db, user), "csrf_token": csrf_for(token), "must_change_password": user.must_change_password}
        resp = JSONResponse(_enc(out))
        resp.set_cookie(COOKIE, token, max_age=s.session_abs_ttl_hours * 3600, httponly=True, secure=s.cookie_secure,
                        samesite="lax", path="/")
        return resp
    finally:
        db.close()


def _enc(x):
    from fastapi.encoders import jsonable_encoder
    return jsonable_encoder(x)


@router.post("/logout", status_code=204)
def logout(request: Request, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    ctx.session.revoked_at, ctx.session.revoke_reason = clock.now(), "logout"
    audit(db, "logout", user=ctx.user, request=request)
    resp = Response(status_code=204)
    resp.delete_cookie(COOKIE, path="/")
    return resp


@router.get("/me")
def me(request: Request, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    return {"user": user_out(db, ctx.user), "csrf_token": csrf_for(token),
            "permissions": PERMISSIONS[ctx.role], "must_change_password": ctx.user.must_change_password}


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, request: Request, ctx: Ctx = Depends(get_ctx),
                    db: DbSession = Depends(get_db)):
    u = ctx.user
    if not verify_password(u.password_hash, body.current_password):
        raise ApiError(401, "INVALID_CREDENTIALS", "Текущий пароль указан неверно.")
    validate_password(body.new_password, u.email, u.full_name)
    if body.new_password == body.current_password:
        raise ApiError(422, "VALIDATION_ERROR", "Новый пароль должен отличаться от текущего.",
                       {"fields": [{"field": "new_password", "code": "same", "message": "Новый пароль должен отличаться."}]})
    u.password_hash = hash_password(body.new_password)
    u.must_change_password, u.temp_password_expires_at = False, None
    u.version += 1
    revoke_user_sessions(db, u.id, "password_changed", except_id=ctx.session.id)
    audit(db, "password_changed", user=u, request=request)


@router.get("/sessions")
def sessions(ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    rows = db.scalars(select(Session).where(Session.user_id == ctx.user.id, Session.revoked_at.is_(None),
                                            Session.expires_at > clock.now()).order_by(Session.created_at.desc())).all()
    return [{"id": r.id, "created_at": r.created_at, "last_seen_at": r.last_seen_at, "ip": str(r.ip) if r.ip else None,
             "user_agent": r.user_agent, "is_current": r.id == ctx.session.id} for r in rows]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: str, request: Request, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db)):
    import uuid
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise not_found()
    s = db.scalar(select(Session).where(Session.id == sid, Session.user_id == ctx.user.id))
    if not s:
        raise not_found()
    s.revoked_at, s.revoke_reason = clock.now(), "logout"
    return Response(status_code=204)
