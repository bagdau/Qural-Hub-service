"""CLI: create-admin, init-pilot, seed-demo, reset-demo, run-jobs, verify-storage."""
import argparse
import getpass
import sys
from datetime import timedelta

from sqlalchemy import func, select, text

from . import clock, jobs, storage
from .config import get_settings
from .db import SessionLocal, engine
from .models import AppMeta, Organization, SlaPolicy, User
from .security import EMAIL_RE, hash_password, validate_password


def get_meta(db, key):
    m = db.get(AppMeta, key)
    return m.value if m else None


def set_meta(db, key, value):
    m = db.get(AppMeta, key)
    if m:
        m.value, m.updated_at = value, clock.now()
    else:
        db.add(AppMeta(key=key, value=value, updated_at=clock.now()))


def ensure_service_org(db, name="Сервисная организация") -> Organization:
    org = db.scalar(select(Organization).where(Organization.kind == "service"))
    if not org:
        now = clock.now()
        org = Organization(kind="service", name=name, created_at=now, updated_at=now)
        db.add(org)
        db.flush()
    return org


def ensure_baseline(db):
    """Данные, нужные всегда: политики SLA и активные шаблоны чек-листов."""
    from .sla import DEFAULT_POLICY
    for p, (r, s) in DEFAULT_POLICY.items():
        if not db.get(SlaPolicy, p):
            db.add(SlaPolicy(priority=p, reaction_minutes=r, resolution_minutes=s))
    from seed.templates import ensure_templates
    ensure_templates(db)


def cmd_create_admin(a):
    db = SessionLocal()
    try:
        if not EMAIL_RE.match(a.email):
            sys.exit("Некорректный email.")
        pw = open(a.password_file, encoding="utf-8").read().strip() if a.password_file else None
        if not pw:
            pw = getpass.getpass("Пароль администратора: ")
            if pw != getpass.getpass("Повторите пароль: "):
                sys.exit("Пароли не совпадают.")
        validate_password(pw, a.email, a.full_name)
        org = ensure_service_org(db)
        if db.scalar(select(User.id).where(func.lower(User.email) == a.email.lower())):
            sys.exit("Пользователь с таким email уже существует.")
        now = clock.now()
        db.add(User(organization_id=org.id, email=a.email.lower(), full_name=a.full_name, role="admin",
                    password_hash=hash_password(pw), must_change_password=False, created_at=now, updated_at=now))
        ensure_baseline(db)
        if not get_meta(db, "deployment_mode"):
            set_meta(db, "deployment_mode", get_settings().app_env if get_settings().app_env in ("dev", "demo", "pilot") else "dev")
        db.commit()
        print(f"Администратор {a.email} создан.")
    finally:
        db.close()


def cmd_init_pilot(a):
    s = get_settings()
    if s.app_env != "pilot":
        sys.exit("init-pilot выполняется только при APP_ENV=pilot.")
    db = SessionLocal()
    try:
        if get_meta(db, "demo_seed_version"):
            sys.exit("В базе есть demo-данные — пилот нужно разворачивать на чистой БД.")
        ensure_service_org(db, a.org_name)
        ensure_baseline(db)
        set_meta(db, "deployment_mode", "pilot")
        db.commit()
        print("Режим pilot зафиксирован. Создайте администратора командой create-admin.")
    finally:
        db.close()


def cmd_seed_demo(a):
    s = get_settings()
    if s.app_env not in ("dev", "test", "demo"):
        print("Отказ: demo-данные запрещены при APP_ENV=%s." % s.app_env, file=sys.stderr)
        sys.exit(2)
    if not s.allow_demo_seed:
        print("Отказ: ALLOW_DEMO_SEED не равен true.", file=sys.stderr)
        sys.exit(2)
    pw = s.demo_password
    if not pw or len(pw) < 12:
        print("Отказ: задайте DEMO_USER_PASSWORD (не менее 12 символов).", file=sys.stderr)
        sys.exit(2)
    db = SessionLocal()
    try:
        if get_meta(db, "deployment_mode") == "pilot":
            print("Отказ: база помечена как pilot.", file=sys.stderr)
            sys.exit(2)
        from seed.loader import SEED_VERSION, load
        if get_meta(db, "demo_seed_version") == SEED_VERSION and not a.force:
            print(f"demo уже загружено (версия {SEED_VERSION}), ничего не изменено.")
            return
        kept: list[dict] = []
        if get_meta(db, "demo_seed_version") and a.force:
            from .models import Session as AuthSession
            kept = [{c.key: getattr(r, c.key) for c in AuthSession.__table__.columns}
                    for r in db.scalars(select(AuthSession).where(AuthSession.revoked_at.is_(None)))]
            reset_all(db)
        counts = load(db, pw)
        if kept:
            from .models import Session as AuthSession, User as AuthUser
            ids = {u for (u,) in db.execute(select(AuthUser.id))}
            for row in kept:
                if row["user_id"] in ids:
                    db.add(AuthSession(**row))        # пользователи демо имеют постоянные id — вход в браузере сохраняется
            counts["sessions_kept"] = sum(1 for r in kept if r["user_id"] in ids)
        set_meta(db, "demo_seed_version", SEED_VERSION)
        if not get_meta(db, "deployment_mode"):
            set_meta(db, "deployment_mode", "demo")
        db.commit()
        print("demo загружено:", counts)
    except SystemExit:
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def reset_all(db):
    names = [r[0] for r in db.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'"))]
    db.execute(text("TRUNCATE " + ", ".join(f'"{n}"' for n in names) + " RESTART IDENTITY CASCADE"))


def cmd_reset_demo(a):
    s = get_settings()
    if s.app_env not in ("dev", "test", "demo"):
        print("Отказ: сброс запрещён при APP_ENV=%s." % s.app_env, file=sys.stderr)
        sys.exit(2)
    if not a.yes:
        sys.exit("Добавьте --yes: будут удалены ВСЕ данные БД.")
    db = SessionLocal()
    try:
        if get_meta(db, "deployment_mode") == "pilot":
            print("Отказ: база помечена как pilot.", file=sys.stderr)
            sys.exit(2)
        reset_all(db)
        db.commit()
        print("Данные очищены.")
    finally:
        db.close()


def cmd_run_jobs(a):
    db = SessionLocal()
    try:
        res = jobs.run_all(db, clock.now(), include_cleanup=True)
        db.commit()
        print(res)
    finally:
        db.close()


def cmd_verify_storage(a):
    db = SessionLocal()
    try:
        rep = jobs.verify_storage(db)
        print(rep)
        sys.exit(1 if rep["missing"] or rep["hash_mismatch"] else 0)
    finally:
        db.close()


def main():
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-admin")
    c.add_argument("--email", required=True)
    c.add_argument("--full-name", default="Администратор")
    c.add_argument("--password-file")
    c.set_defaults(fn=cmd_create_admin)
    c = sub.add_parser("init-pilot")
    c.add_argument("--org-name", default="Сервисная организация")
    c.set_defaults(fn=cmd_init_pilot)
    c = sub.add_parser("seed-demo")
    c.add_argument("--force", action="store_true")
    c.set_defaults(fn=cmd_seed_demo)
    c = sub.add_parser("reset-demo")
    c.add_argument("--yes", action="store_true")
    c.set_defaults(fn=cmd_reset_demo)
    c = sub.add_parser("run-jobs")
    c.set_defaults(fn=cmd_run_jobs)
    c = sub.add_parser("verify-storage")
    c.set_defaults(fn=cmd_verify_storage)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
