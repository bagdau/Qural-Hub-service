"""Сеанс входа: 10 минут без действий, продление активностью, настоящие часы (не зависят от замороженных часов demo)."""
from datetime import timedelta

from sqlalchemy import select

from app import clock
from app.db import SessionLocal
from app.models import Session


def _current_session(u):
    sid = next(s["id"] for s in u.dsp.get("/auth/sessions").json() if s["is_current"])
    return sid


def test_me_reports_idle_ttl(u):
    r = u.dsp.get("/auth/me").json()
    assert r["session"]["idle_ttl_seconds"] == 600


def test_activity_extends_the_session_but_idle_expires_it(u):
    sid = _current_session(u)
    now = clock.real_now()
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.id == sid))
        s.last_seen_at, s.idle_expires_at = now - timedelta(seconds=90), now + timedelta(seconds=60)
        db.commit()
    assert u.dsp.get("/auth/me").status_code == 200           # обращение продлило сеанс до ~10 минут
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.id == sid))
        assert s.idle_expires_at > clock.real_now() + timedelta(minutes=9)
        s.idle_expires_at = clock.real_now() - timedelta(seconds=1)   # 10 минут без действий прошли
        db.commit()
    r = u.dsp.get("/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
