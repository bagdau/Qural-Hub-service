"""Сеанс входа: 10 минут без действий, продление активностью, настоящие часы (не зависят от замороженных часов demo)."""
from datetime import timedelta

from sqlalchemy import select

from app import clock
from app.db import SessionLocal
from app.models import Session


def _current_session(u):
    sid = next(s["id"] for s in u.mgr.get("/auth/sessions").json() if s["is_current"])
    return sid


def test_me_reports_idle_ttl(u):
    r = u.mgr.get("/auth/me").json()
    assert r["session"]["idle_ttl_seconds"] == 600


def test_activity_extends_the_session_but_idle_expires_it(u):
    sid = _current_session(u)
    now = clock.real_now()
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.id == sid))
        s.last_seen_at, s.idle_expires_at = now - timedelta(seconds=90), now + timedelta(seconds=60)
        db.commit()
    assert u.mgr.get("/auth/me").status_code == 200           # обращение продлило сеанс до ~10 минут
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.id == sid))
        assert s.idle_expires_at > clock.real_now() + timedelta(minutes=9)
        s.idle_expires_at = clock.real_now() - timedelta(seconds=1)   # 10 минут без действий прошли
        db.commit()
    r = u.mgr.get("/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"




def test_admin_assigns_individual_passwords(u, app):
    """Администратор назначает каждому свой пароль: политика, вход по нему, завершение старых сеансов, права, аудит без пароля."""
    from fastapi.testclient import TestClient

    org = u.adm.get("/organizations", params={"page_size": 100}).json()["items"]
    service = next(o for o in org if o["kind"] == "service")
    mk = lambda email, pw, **kw: u.adm.post("/users", json={"email": email, "full_name": "Тест Пароли", "role": "dispatcher", "organization_id": service["id"], "password": pw, **kw})

    assert mk("pw1@demo.alageum.test", "short").status_code == 422                      # слабый пароль отклонён
    r = mk("pw1@demo.alageum.test", "Own-Password-1234")
    assert r.status_code == 201 and "temp_password" not in r.json()                     # заданный пароль не возвращается и не создаётся временный
    user = r.json()["user"]
    assert user["must_change_password"] is False

    def login(email, pw):
        c = TestClient(app, raise_server_exceptions=False)
        x = c.post("/api/v1/auth/login", json={"email": email, "password": pw})
        return c, x

    c1, x = login("pw1@demo.alageum.test", "Own-Password-1234")
    assert x.status_code == 200 and c1.get("/api/v1/auth/me").status_code == 200

    v = u.adm.get(f"/users/{user['id']}").json()["version"]
    assert u.dsp.post(f"/users/{user['id']}/set-password", json={"version": v, "password": "Another-Pass-5678"}).status_code == 403   # не администратор
    assert u.adm.post(f"/users/{user['id']}/set-password", json={"version": v, "password": "weak"}, idem=False).status_code == 422
    ok = u.adm.post(f"/users/{user['id']}/set-password", json={"version": v, "password": "Another-Pass-5678", "must_change": True}, idem=False)
    assert ok.status_code == 204
    assert c1.get("/api/v1/auth/me").status_code == 401                                   # прежний сеанс завершён
    assert login("pw1@demo.alageum.test", "Own-Password-1234")[1].status_code == 401      # старый пароль не работает
    c2, y = login("pw1@demo.alageum.test", "Another-Pass-5678")
    assert y.status_code == 200 and y.json()["must_change_password"] is True              # потребована смена при входе
    stale = u.adm.post(f"/users/{user['id']}/set-password", json={"version": v, "password": "Third-Pass-91011"}, idem=False)
    assert stale.status_code == 409                                                       # версия устарела

    audit = u.adm.get("/audit-log", params={"action": "password_set", "page_size": 5}).json()["items"]
    assert audit and "Another-Pass" not in str(audit)                                     # пароль в журнал не попадает
