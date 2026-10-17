import hashlib
import hmac
import ipaddress
import re
import secrets
import string
import uuid
from dataclasses import dataclass
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from . import clock
from .config import get_settings
from .db import SessionLocal, get_db
from .errors import ApiError, field_error
from .models import AuditLog, Organization, Session, User

COOKIE = "ash_session"
_ph = PasswordHasher()
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
PW_EXEMPT = ("/api/v1/auth/change-password", "/api/v1/auth/me", "/api/v1/auth/logout")
COMMON_PASSWORDS = {
    "password1234", "123456789012", "qwertyuiop12", "administrator", "welcome12345", "letmein12345",
    "password12345", "iloveyou1234", "changeme1234", "123123123123", "qwerty123456", "admin1234567",
}


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(h: str, pw: str) -> bool:
    try:
        return _ph.verify(h, pw)
    except (VerificationError, InvalidHashError):
        return False


def validate_password(pw: str, email: str = "", full_name: str = "") -> None:
    problems = []
    if len(pw) < 12:
        problems.append("Минимум 12 символов.")
    if len(pw) > 128:
        problems.append("Максимум 128 символов.")
    if pw.lower() in (email.lower(), full_name.lower()) or pw.lower() in COMMON_PASSWORDS:
        problems.append("Пароль слишком простой или совпадает с email/ФИО.")
    if problems:
        raise field_error("new_password", "weak_password", " ".join(problems))


def generate_temp_password() -> str:
    alphabet = string.ascii_letters.replace("l", "").replace("I", "").replace("O", "") + "23456789"
    while True:
        p = "".join(secrets.choice(alphabet) for _ in range(14))
        if any(c.isdigit() for c in p) and any(c.islower() for c in p) and any(c.isupper() for c in p):
            return p


def token_hash(token: str) -> bytes:
    return hashlib.sha256((token + get_settings().secret).encode()).digest()


def csrf_for(token: str) -> str:
    return hmac.new(get_settings().secret.encode(), token.encode(), hashlib.sha256).hexdigest()


def client_ip(request: Request | None):
    try:
        return str(ipaddress.ip_address(request.client.host)) if request and request.client else None
    except ValueError:
        return None


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")


@dataclass
class Ctx:
    user: User
    session: Session
    request_id: uuid.UUID

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def is_service(self) -> bool:
        return self.user.role in ("admin", "dispatcher", "engineer", "manager")


def audit(db: DbSession, action: str, *, user: User | None = None, actor_role: str | None = None,
          object_type: str | None = None, object_id=None, request: Request | None = None, details=None) -> None:
    db.add(AuditLog(
        occurred_at=clock.now(), actor_user_id=user.id if user else None,
        actor_role=actor_role or (user.role if user else None), action=action, object_type=object_type,
        object_id=str(object_id) if object_id else None,
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent", "")[:300] if request else None),
        request_id=getattr(request.state, "request_id", None) if request else None,
        details=details or {},
    ))


def audit_isolated(action: str, **kw) -> None:
    """Запись аудита в отдельной транзакции (сохраняется даже при откате запроса)."""
    s = SessionLocal()
    try:
        audit(s, action, **kw)
        s.commit()
    except Exception:
        s.rollback()
    finally:
        s.close()


def get_ctx(request: Request, db: DbSession = Depends(get_db, scope="function")) -> Ctx:
    token = request.cookies.get(COOKIE)
    if not token:
        raise ApiError(401, "UNAUTHENTICATED", "Требуется вход в систему.")
    now = clock.real_now()
    sess = db.scalar(select(Session).where(Session.token_hash == token_hash(token)))
    if not sess or sess.revoked_at or sess.expires_at <= now or sess.idle_expires_at <= now:
        raise ApiError(401, "UNAUTHENTICATED", "Сессия завершена. Войдите снова.")
    user = db.get(User, sess.user_id)
    if not user or not user.is_active:
        raise ApiError(401, "UNAUTHENTICATED", "Сессия завершена. Войдите снова.")
    org = db.get(Organization, user.organization_id)
    if org.archived_at is not None and user.role == "client":
        raise ApiError(401, "UNAUTHENTICATED", "Сессия завершена. Войдите снова.")
    if request.method in UNSAFE:
        sent = request.headers.get("x-csrf-token", "")
        if not hmac.compare_digest(sent, csrf_for(token)):
            raise ApiError(403, "CSRF_FAILED", "Недействительный CSRF-токен.")
    if user.must_change_password and request.url.path not in PW_EXEMPT:
        raise ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Необходимо сменить временный пароль.")
    s = get_settings()
    if (now - sess.last_seen_at).total_seconds() > 15:       # любое обращение продлевает сеанс (не чаще раза в 15 с)
        sess.last_seen_at = now
        sess.idle_expires_at = min(now + timedelta(minutes=s.session_idle_ttl_minutes), sess.expires_at)
    return Ctx(user, sess, getattr(request.state, "request_id", uuid.uuid4()))


def require(*roles: str):
    def dep(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        if ctx.role not in roles:
            from .errors import forbidden
            raise forbidden()
        return ctx
    return dep


def create_session(db: DbSession, user: User, request: Request) -> str:
    s = get_settings()
    now = clock.real_now()
    token = secrets.token_urlsafe(32)
    db.add(Session(
        user_id=user.id, token_hash=token_hash(token), created_at=now, last_seen_at=now,
        idle_expires_at=now + timedelta(minutes=s.session_idle_ttl_minutes),
        expires_at=now + timedelta(minutes=s.session_abs_ttl_minutes),
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:300],
    ))
    return token


def revoke_user_sessions(db: DbSession, user_id, reason: str, except_id=None) -> int:
    now = clock.now()
    rows = db.scalars(select(Session).where(Session.user_id == user_id, Session.revoked_at.is_(None))).all()
    n = 0
    for r in rows:
        if except_id and r.id == except_id:
            continue
        r.revoked_at = now
        r.revoke_reason = reason
        n += 1
    return n
