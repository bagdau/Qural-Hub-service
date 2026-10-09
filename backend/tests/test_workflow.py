"""Интеграционные тесты жизненного цикла (изменяют данные; свой экземпляр demo-БД)."""
import threading
import uuid
from datetime import timedelta

import pytest

from seed.loader import default_answers
from tests.conftest import Api, equipment_id, png_bytes, ticket_by_number


def make_ticket(cl, inv="DM-KTP-0002", urgency="urgent", title="Тестовая неисправность КТП"):
    r = cl.post("/tickets", json={"equipment_id": equipment_id(cl, inv), "title": title,
                                  "description": "Описание проблемы для автотеста, более десяти символов.", "urgency": urgency})
    assert r.status_code == 201, r.text
    return r.json()


def act(api, t, name, expect=200, **body):
    r = api.post(f"/tickets/{t['id']}/{name}", json={"version": t["version"], **body})
    assert r.status_code == expect, f"{name}: {r.status_code} {r.text}"
    return r.json()


def engineer_id(api, full_name="Инженер Демо-2"):
    return next(e["id"] for e in api.get("/engineers").json() if e["full_name"] == full_name)


def get(api, t):
    return api.get(f"/tickets/{t['id']}").json()


def upload(api, t, stage, data=None, name="p.png", expect=201):
    r = api.c.post(f"/api/v1/tickets/{t['id']}/attachments", data={"kind": "photo", "stage": stage},
                   files={"file": (name, data or png_bytes(), "image/png")}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == expect, r.text
    return r.json()


def to_in_progress(u, inv="DM-KTP-0002", eng="eng2", priority="high"):
    t = make_ticket(u.cl1, inv)
    t = act(u.dsp, t, "accept", priority=priority)
    t = act(u.dsp, t, "assign", engineer_id=engineer_id(u.dsp, "Инженер Демо-2" if eng == "eng2" else "Инженер Демо-1"))
    api = getattr(u, eng)
    return act(api, t, "start"), api


def fill_report(api, t, photos=True, parts=True):
    rep = api.get(f"/tickets/{t['id']}/report").json()
    answers = default_answers(rep["template"]["schema"])
    r = api.put(f"/tickets/{t['id']}/report", json={
        "version": rep["version"], "diagnosis": "Ослабление контактных соединений, локальный нагрев.",
        "work_performed": "Подтянуты контакты, выполнена проверка тепловизором и замеры.", "result_code": "resolved",
        "result_summary": "Нагрев устранён.", "labor_minutes": 90, "checklist_answers": answers, "parts_confirmed": True})
    assert r.status_code == 200, r.text
    if photos:
        upload(api, t, "before")
        upload(api, t, "after")
    if parts:
        sp = api.get("/spare-parts").json()["items"][0]
        assert api.post(f"/tickets/{t['id']}/parts", json={"spare_part_id": sp["id"], "quantity": 1}, idem=False).status_code == 201


# ---------------- авторизация ----------------
def test_it05_it06_it07_auth(u, app):
    adm = u.adm
    org = adm.get("/organizations", params={"kind": "client"}).json()["items"][0]["id"]
    r = adm.post("/users", json={"email": "new.client@demo.alageum.test", "full_name": "Новый Клиент", "role": "client", "organization_id": org})
    assert r.status_code == 201
    temp = r.json()["temp_password"]
    assert adm.get(f"/users/{r.json()['user']['id']}").json().get("temp_password") is None
    c = Api(app, None)
    r = c.post("/auth/login", json={"email": "new.client@demo.alageum.test", "password": temp}, idem=False)
    assert r.status_code == 200 and r.json()["must_change_password"]
    c.c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    assert c.get("/tickets").json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert c.post("/auth/change-password", json={"current_password": temp, "new_password": "short"}, idem=False).status_code == 422
    assert c.post("/auth/change-password", json={"current_password": temp, "new_password": "Brand-New-Pass-77"}, idem=False).status_code == 204
    assert c.get("/tickets").status_code == 200
    # CSRF
    no_csrf = Api(app, "client.metal@demo.alageum.test")
    del no_csrf.c.headers["X-CSRF-Token"]
    assert no_csrf.post("/auth/logout", idem=False).status_code == 403
    # регистрации нет
    assert Api(app, None).post("/auth/register", json={}, idem=False).status_code in (404, 405)
    # блокировка после 5 неверных паролей
    v = Api(app, None)
    codes = [v.post("/auth/login", json={"email": "client.agro@demo.alageum.test", "password": "wrong-password-1"}, idem=False).status_code for _ in range(5)]
    assert codes[:4] == [401] * 4 and codes[4] == 423
    assert v.post("/auth/login", json={"email": "client.agro@demo.alageum.test", "password": "wrong"}, idem=False).status_code == 423


def test_it02_it08_deactivate_and_password_change(u, app):
    adm = u.adm
    org = adm.get("/organizations", params={"kind": "client"}).json()["items"][0]["id"]
    r = adm.post("/users", json={"email": "tmp.user@demo.alageum.test", "full_name": "Временный Пользователь", "role": "client", "organization_id": org})
    uid, temp, ver = r.json()["user"]["id"], r.json()["temp_password"], r.json()["user"]["version"]
    s1, s2 = Api(app, None), Api(app, None)
    for s in (s1, s2):
        lr = s.post("/auth/login", json={"email": "tmp.user@demo.alageum.test", "password": temp}, idem=False)
        s.c.headers["X-CSRF-Token"] = lr.json()["csrf_token"]
    assert s1.post("/auth/change-password", json={"current_password": temp, "new_password": "Another-Pass-1234"}, idem=False).status_code == 204
    assert s2.get("/auth/me").status_code == 401  # остальные сессии отозваны
    assert s1.get("/auth/me").status_code == 200
    me_ver = adm.get(f"/users/{uid}").json()["version"]
    assert adm.post(f"/users/{uid}/deactivate", json={"version": me_ver}, idem=False).status_code == 200
    assert s1.get("/auth/me").status_code == 401
    # нельзя: себя, последнего админа
    me = adm.get("/auth/me").json()["user"]
    assert adm.post(f"/users/{me['id']}/deactivate", json={"version": me["version"]}, idem=False).json()["error"]["code"] == "SELF_DEACTIVATION"
    # инженер с активными заявками
    e1 = engineer_id(adm, "Инженер Демо-1")
    r = adm.post(f"/users/{e1}/deactivate", json={"version": adm.get(f"/users/{e1}").json()["version"]}, idem=False)
    assert r.status_code == 409 and r.json()["error"]["code"] == "USER_HAS_ACTIVE_ASSIGNMENTS"


# ---------------- переходы ----------------
def test_it09_it10_invalid_and_forbidden(u):
    t = make_ticket(u.cl1)
    act(u.dsp, t, "complete", expect=403)
    r = u.dsp.post(f"/tickets/{t['id']}/start", json={"version": t["version"]})
    assert r.status_code == 403  # start — только инженер
    r = act(u.cl1, t, "confirm", expect=409, act_id=str(uuid.uuid4()))
    assert r["error"]["code"] == "INVALID_TRANSITION" and "allowed_actions" in r["error"]["details"]
    act(u.cl1, t, "accept", expect=403, priority="high")
    act(u.mgr, t, "accept", expect=403, priority="high")
    act(u.eng1, t, "accept", expect=404, priority="high")
    t2 = act(u.dsp, t, "accept", priority="high")
    r = act(u.dsp, t2, "accept", expect=409, priority="high")
    assert r["error"]["code"] == "INVALID_TRANSITION"
    stale = act(u.dsp, t2, "priority", priority="critical", reason="смена для теста")
    r = u.dsp.post(f"/tickets/{t2['id']}/priority", json={"version": t2["version"], "priority": "high", "reason": "повтор"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_CONFLICT" and r.json()["error"]["details"]["current_version"] == stale["version"]
    # клиент не может отменить после начала работ
    asg = act(u.dsp, stale, "assign", engineer_id=engineer_id(u.dsp))
    started = act(u.eng2, asg, "start")
    assert act(u.cl1, started, "cancel", expect=409, reason="передумал")["error"]["code"] == "INVALID_TRANSITION"
    r = u.eng1.post(f"/tickets/{started['id']}/pause", json={"version": started["version"], "reason_code": "other", "comment": "не моя заявка!!", "next_action": "ничего не делать", "expected_resume_at": "2030-01-01T00:00:00Z"})
    assert r.status_code == 404  # чужая заявка вне области видимости


def test_it11_concurrent_assign(u):
    t = act(u.dsp, make_ticket(u.cl1), "accept", priority="normal")
    e1, e2 = engineer_id(u.dsp, "Инженер Демо-1"), engineer_id(u.dsp, "Инженер Демо-2")
    from app import clock
    res = []
    barrier = threading.Barrier(2)

    def go(eng):
        api = Api(u.dsp.c.app, "dispatcher@demo.alageum.test")
        barrier.wait()
        res.append(api.post(f"/tickets/{t['id']}/assign", json={"version": t["version"], "engineer_id": eng}))
    th = [threading.Thread(target=go, args=(e,)) for e in (e1, e2)]
    [x.start() for x in th]
    [x.join() for x in th]
    codes = sorted(r.status_code for r in res)
    assert codes == [200, 409], [r.text for r in res]
    assert [r for r in res if r.status_code == 409][0].json()["error"]["code"] == "VERSION_CONFLICT"
    final = get(u.dsp, t)
    assignments = u.dsp.get(f"/tickets/{t['id']}/assignments").json()
    assert len([a for a in assignments if a["ended_at"] is None]) == 1 and final["status"] == "assigned"
    assert sum(1 for e in u.dsp.get(f"/tickets/{t['id']}/events").json()["items"] if e["event_type"] == "assigned") == 1


def test_it13_idempotent_create(u):
    body = {"equipment_id": equipment_id(u.cl1, "DM-TR-0004"), "title": "Дубль запроса", "description": "Проверка идемпотентности создания заявки."}
    key = {"Idempotency-Key": str(uuid.uuid4())}
    before = u.cl1.get("/tickets").json()["total"]
    r1 = u.cl1.post("/tickets", json=body, headers=key, idem=False)
    r2 = u.cl1.post("/tickets", json=body, headers=key, idem=False)
    assert r1.status_code == r2.status_code == 201 and r1.json()["id"] == r2.json()["id"]
    assert r2.headers.get("idempotent-replay") == "true"
    assert u.cl1.get("/tickets").json()["total"] == before + 1
    r3 = u.cl1.post("/tickets", json={**body, "title": "Другой запрос"}, headers=key, idem=False)
    assert r3.status_code == 422 and r3.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    r4 = u.cl1.post("/tickets", json=body, idem=False)
    assert r4.status_code == 400 and r4.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
    # повторное предупреждение о дубле
    assert any(w["code"] == "ACTIVE_TICKET_EXISTS" for w in u.cl1.post("/tickets", json=body).json()["warnings"])


def test_it14_validation(u):
    eq = equipment_id(u.cl1, "DM-TR-0004")
    r = u.cl1.post("/tickets", json={"equipment_id": eq, "title": "", "description": ""})
    assert r.status_code == 422
    fields = {f["field"] for f in r.json()["error"]["details"]["fields"]}
    assert {"title", "description"} <= fields
    t = to_in_progress(u)[0]
    r = u.eng2.post(f"/tickets/{t['id']}/pause", json={"version": t["version"], "reason_code": "other", "comment": "коротко", "next_action": "", "expected_resume_at": "2030-01-01T00:00:00Z"})
    assert r.status_code == 422
    new = make_ticket(u.cl1)
    r = u.dsp.post(f"/tickets/{new['id']}/reject", json={"version": new["version"], "reason_code": "other", "comment": "abc"})
    assert r.status_code == 422


def test_it19_pause_resume_sla(u):
    t, eng = to_in_progress(u)
    paused = act(eng, t, "pause", reason_code="waiting_parts", comment="Нужен контактор, на объекте нет.",
                 next_action="Диспетчер заказывает контактор.", expected_resume_at="2030-01-01T00:00:00Z")
    assert paused["status"] == "paused" and paused["sla"]["clock_running"] is False and paused["pause"]["reason_code"] == "waiting_parts"
    resumed = act(u.dsp, paused, "resume")
    assert resumed["status"] == "in_progress" and resumed["sla"]["clock_running"] and resumed["pause"] is None
    ev = [e["event_type"] for e in u.dsp.get(f"/tickets/{t['id']}/events").json()["items"]]
    assert "paused" in ev and "resumed" in ev


# ---------------- завершение, акты, возврат ----------------
def test_it17_complete_requires_photos_then_flow_return_and_outdated(u):
    t, eng = to_in_progress(u, "DM-TR-0004")
    # без отчёта
    r = eng.post(f"/tickets/{t['id']}/complete", json={"version": t["version"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "COMPLETION_REQUIREMENTS_NOT_MET"
    fill_report(eng, t, photos=False, parts=False)
    codes = {f["code"] for f in eng.post(f"/tickets/{t['id']}/complete", json={"version": t["version"]}).json()["error"]["details"]["failed_checks"]}
    assert codes == {"PHOTOS_MISSING"}
    upload(eng, t, "before"); upload(eng, t, "after")
    done = act(eng, t, "complete")
    assert done["status"] == "awaiting_confirmation" and done["current_act"]["version"] == 1 and done["sla"]["clock_running"] is False
    a1 = done["current_act"]["id"]
    pdf = u.cl1.get(f"/acts/{a1}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    # возврат: короткий комментарий отклоняется
    assert u.cl1.post(f"/tickets/{t['id']}/return", json={"version": done["version"], "act_id": a1, "comment": "мало"}).status_code == 422
    ret = act(u.cl1, done, "return", act_id=a1, comment="Нагрев остался, прошу проверить ещё раз.")
    assert ret["status"] == "in_progress" and ret["return_count"] == 1 and ret["sla"]["clock_running"]
    acts = u.cl1.get(f"/tickets/{t['id']}/acts").json()
    assert acts[0]["is_current"] is False and acts[0]["decision"] == "returned"
    assert u.cl1.get(f"/acts/{a1}/pdf").status_code == 200  # старый акт сохранён
    rep = eng.get(f"/tickets/{t['id']}/report").json()
    assert rep["revision"] == 2 and rep["status"] == "draft" and rep["diagnosis"]
    done2 = act(eng, ret, "complete")
    a2 = done2["current_act"]["id"]
    assert done2["current_act"]["version"] == 2 and a2 != a1
    # подтверждение старой версии
    r = u.cl1.post(f"/tickets/{t['id']}/confirm", json={"version": done2["version"], "act_id": a1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ACT_OUTDATED"
    closed = act(u.cl1, done2, "confirm", act_id=a2, rating=5)
    assert closed["status"] == "closed"
    # IT-23: закрытая заявка неизменяема
    assert u.dsp.patch(f"/tickets/{t['id']}", json={"version": closed["version"], "title": "Новое название заявки"}).status_code == 409
    assert u.eng2.put(f"/tickets/{t['id']}/report", json={"version": 99, "diagnosis": "x"}).status_code == 409
    upload(eng, t, "other", expect=409)
    assert u.dsp.post(f"/tickets/{t['id']}/comments", json={"body": "Комментарий после закрытия"}).status_code == 201


def test_it22_act_generation_failure_rolls_back(u, monkeypatch):
    t, eng = to_in_progress(u, "DM-RU-0003")
    fill_report(eng, t)
    from app import pdf, storage
    import os
    before_files = set()
    for root, _, fs in os.walk(storage.root() / "acts"):
        before_files.update(fs)

    def boom(*a, **k):
        raise RuntimeError("render failed")
    monkeypatch.setattr(pdf, "render_act", boom)
    r = eng.post(f"/tickets/{t['id']}/complete", json={"version": t["version"]})
    assert r.status_code == 500 and r.json()["error"]["code"] == "ACT_GENERATION_FAILED" and r.json()["error"]["request_id"]
    cur = get(u.dsp, t)
    assert cur["status"] == "in_progress" and cur["current_act"] is None and cur["version"] == t["version"]
    assert eng.get(f"/tickets/{t['id']}/report").json()["status"] == "draft"
    monkeypatch.undo()
    ok = eng.post(f"/tickets/{t['id']}/complete", json={"version": t["version"]})
    assert ok.status_code == 200


def test_it34_photo_exception_flow(u):
    t, eng = to_in_progress(u, "DM-TR-0004")
    fill_report(eng, t, photos=False, parts=False)
    rep = eng.get(f"/tickets/{t['id']}/report").json()
    assert eng.post(f"/tickets/{t['id']}/photo-exception", json={"version": rep["version"], "reason": "коротко"}).status_code == 422
    r = eng.post(f"/tickets/{t['id']}/photo-exception", json={"version": rep["version"], "reason": "Съёмка запрещена правилами площадки."})
    assert r.status_code == 200 and r.json()["photo_exception"]["status"] == "requested"
    assert u.dsp.get(f"/tickets/{t['id']}/report").json()["photo_exception"]["status"] == "requested"
    r = u.dsp.post(f"/tickets/{t['id']}/photo-exception/decision", json={"version": r.json()["version"], "decision": "approved"}, idem=False)
    assert r.status_code == 200
    assert act(eng, t, "complete")["status"] == "awaiting_confirmation"
    assert not any(e["event_type"].startswith("photo_exception") for e in u.cl1.get(f"/tickets/{t['id']}/events").json()["items"])


def test_it27_reassign_history(u):
    t, eng = to_in_progress(u, "DM-KTP-0002", eng="eng2")
    new = act(u.dsp, t, "reassign", engineer_id=engineer_id(u.dsp, "Инженер Демо-1"), reason="Занят на другой площадке")
    assert new["status"] == "assigned" and new["assigned_engineer"]["full_name"] == "Инженер Демо-1"
    assert u.eng2.get(f"/tickets/{t['id']}").status_code == 404
    assert u.eng1.get(f"/tickets/{t['id']}/report").status_code == 200  # черновик перешёл к новому инженеру
    assignments = u.dsp.get(f"/tickets/{t['id']}/assignments").json()
    assert [a["end_reason"] for a in assignments] == ["reassigned", None]
    ev = u.cl1.get(f"/tickets/{t['id']}/events", params={"page_size": 100}).json()["items"]
    re_ev = [e for e in ev if e["event_type"] == "assigned"]
    assert len(re_ev) == 2 and all("reason" not in e["payload"] for e in re_ev)  # клиент не видит причину


def test_it28_it18_parts_optional_and_uploads(u):
    t, eng = to_in_progress(u, "DM-RU-0003")
    # неверные файлы
    for name, data, code in [("a.jpg", b"MZ\x90\x00 exe", 415), ("b.png", b"\x00" * (11 * 1024 * 1024), 413)]:
        r = eng.c.post(f"/api/v1/tickets/{t['id']}/attachments", data={"kind": "photo", "stage": "before"},
                       files={"file": (name, data, "image/jpeg")}, headers={"Idempotency-Key": str(uuid.uuid4())})
        assert r.status_code == code, (name, r.text)
    r = eng.c.post(f"/api/v1/tickets/{t['id']}/attachments", data={"kind": "photo"}, files={"file": ("c.png", png_bytes(), "image/png")},
                   headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 422  # стадия обязательна
    assert len(u.dsp.get(f"/tickets/{t['id']}/attachments").json()) == 0
    # без запчастей, parts_confirmed=true — завершение возможно, ожидание запчастей не требуется
    fill_report(eng, t, parts=False)
    assert act(eng, t, "complete")["status"] == "awaiting_confirmation"


def test_it24_db_immutability(app):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        for sql in ["UPDATE ticket_events SET comment='x'", "DELETE FROM ticket_events", "UPDATE audit_log SET action='x'",
                    "DELETE FROM comments", "UPDATE acts SET sha256='0'", "DELETE FROM acts",
                    "UPDATE tickets SET title='Новое' WHERE status='closed'",
                    "UPDATE checklist_templates SET title='x' WHERE status='active'"]:
            with pytest.raises(DBAPIError):
                db.execute(text(sql))
            db.rollback()
        with pytest.raises(DBAPIError):  # вторая активная запись назначения
            db.execute(text("INSERT INTO assignments(id, ticket_id, engineer_id, assigned_by, assigned_at) "
                            "SELECT gen_random_uuid(), ticket_id, engineer_id, assigned_by, now() FROM assignments WHERE ended_at IS NULL LIMIT 1"))
        db.rollback()
        with pytest.raises(DBAPIError):  # оборудование на площадке чужой организации
            db.execute(text("INSERT INTO equipment(id, organization_id, site_id, type, inventory_number, name, qr_code, technical_state, passport_data, version) "
                            "SELECT gen_random_uuid(), (SELECT id FROM organizations WHERE name LIKE '%Агро%'), s.id, 'transformer', 'X-1', 'Тест', 'ZZZZZZZZZZZZ', 'operational', '{}', 1 FROM sites s WHERE s.name LIKE '%Металл-Север%'"))
        db.rollback()
    finally:
        db.close()


def test_it25_scheduler_idempotent(u):
    from app import clock, jobs
    from app.db import SessionLocal
    from datetime import datetime, timezone
    clock.set_override(datetime(2026, 3, 17, 5, 0, tzinfo=timezone.utc))
    try:
        for _ in range(3):
            db = SessionLocal()
            jobs.run_all(db, clock.now())
            db.commit()
            db.close()
        plans = u.dsp.get("/tickets", params={"kind": "planned", "equipment_id": equipment_id(u.dsp, "DL-RU-0003")}).json()
        assert plans["total"] == 1
        t = plans["items"][0]
        assert t["plan_due_date"] == "2026-03-24" and t["priority"] == "low" and t["source"] == "scheduler"
        # SLA-уведомления не дублируются
        n1 = u.mgr.get("/notifications/unread-count").json()["count"]
        db = SessionLocal(); jobs.run_all(db, clock.now()); db.commit(); db.close()
        assert u.mgr.get("/notifications/unread-count").json()["count"] == n1
    finally:
        clock.set_override(None)


def test_it32_seed_guards_and_idempotent(app, monkeypatch):
    import subprocess, sys
    from app import cli
    from app.db import SessionLocal
    import argparse
    monkeypatch.setenv("APP_ENV", "pilot")
    from app.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(Exception):
        get_settings()  # pilot без COOKIE_SECURE запрещён конфигурацией
    monkeypatch.setenv("APP_ENV", "demo")
    get_settings.cache_clear()
    monkeypatch.setenv("ALLOW_DEMO_SEED", "false")
    get_settings.cache_clear()
    with pytest.raises(SystemExit) as e:
        cli.cmd_seed_demo(argparse.Namespace(force=False))
    assert e.value.code == 2
    monkeypatch.setenv("ALLOW_DEMO_SEED", "true")
    monkeypatch.setenv("APP_ENV", "test")
    get_settings.cache_clear()
    from sqlalchemy import func, select
    from app.models import Ticket
    db = SessionLocal(); before = db.scalar(select(func.count()).select_from(Ticket)); db.close()
    cli.cmd_seed_demo(argparse.Namespace(force=False))  # no-op
    db = SessionLocal(); after = db.scalar(select(func.count()).select_from(Ticket)); db.close()
    assert before == after


def test_version_conflict_on_patch(u):
    t = make_ticket(u.cl1)
    ok = u.cl1.patch(f"/tickets/{t['id']}", json={"version": t["version"], "title": "Обновлённая тема заявки"})
    assert ok.status_code == 200
    stale = u.cl1.patch(f"/tickets/{t['id']}", json={"version": t["version"], "title": "Ещё одна тема заявки"})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"
    assert stale.json()["error"]["details"]["current_version"] == ok.json()["version"]
