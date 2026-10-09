"""Интеграционные тесты на demo-данных (read-only): аналитика, видимость, уведомления."""
import pytest

from tests.conftest import equipment_id, ticket_by_number


def test_it30_analytics_matches_seed(u):
    s = u.mgr.get("/analytics/summary").json()
    assert s["tickets_total"] == 20
    assert s["by_status"] == {"new": 2, "accepted": 1, "assigned": 2, "in_progress": 3, "paused": 2,
                              "awaiting_confirmation": 2, "closed": 5, "rejected": 1, "cancelled": 2}
    assert s["active"]["count"] == 12
    assert s["active"]["by_priority"] == {"critical": 2, "high": 4, "normal": 5, "low": 1}
    assert s["overdue"] == {"count": 2, "resolution": 1, "reaction": 1}
    assert s["reaction"] == {"avg_seconds": 2300, "sample": 15}
    assert s["completion"] == {"avg_seconds": 116743, "sample": 7}
    assert s["on_time"] == {"count": 6, "sample": 7, "pct": 85.7}
    assert s["repeat_failures"]["count"] == 2 and s["repeat_failures"]["corrective_total"] == 15 and s["repeat_failures"]["pct"] == 13.3
    load = {e["full_name"]: (e["load"], e["load_pct"]) for e in s["engineer_load"]}
    assert load == {"Инженер Демо-1": (3, 75.0), "Инженер Демо-2": (4, 100.0)}


def test_it30_drilldown_matches_numbers(u):
    for metric, n in [("active", 12), ("overdue", 2), ("reaction", 15), ("completion", 7), ("on_time", 6), ("repeat", 2)]:
        r = u.mgr.get("/analytics/metric-tickets", params={"metric": metric, "page_size": 50}).json()
        assert r["total"] == n, metric
    overdue = {t["number"] for t in u.mgr.get("/analytics/metric-tickets", params={"metric": "overdue"}).json()["items"]}
    assert overdue == {"SR-2026-0008", "SR-2026-0017"}
    rep = {t["number"] for t in u.mgr.get("/analytics/metric-tickets", params={"metric": "repeat"}).json()["items"]}
    assert rep == {"SR-2026-0011", "SR-2026-0012"}


@pytest.mark.parametrize("who,total,active,overdue,react,comp,ontime,rep", [
    ("cl1", 8, 4, 0, 3171, 86400, 100.0, 20.0),
    ("cl2", 5, 3, 1, 1125, 102600, 100.0, 0.0),
    ("cl3", 7, 5, 1, 1950, 266400, 0.0, 16.7),
])
def test_it31_client_analytics(u, who, total, active, overdue, react, comp, ontime, rep):
    api = getattr(u, who)
    s = api.get("/analytics/summary", params={"organization_id": "00000000-0000-0000-0000-000000000000"}).json()
    assert s["tickets_total"] == total and s["active"]["count"] == active and s["overdue"]["count"] == overdue
    assert s["reaction"]["avg_seconds"] == react and s["completion"]["avg_seconds"] == comp
    assert s["on_time"]["pct"] == ontime and s["repeat_failures"]["pct"] == rep
    assert "engineer_load" not in s


@pytest.mark.parametrize("who,count", [("dsp", 9), ("mgr", 2), ("eng1", 3), ("eng2", 3), ("cl1", 3), ("cl2", 4), ("cl3", 3), ("adm", 0)])
def test_it26_unread_notifications(u, who, count):
    assert getattr(u, who).get("/notifications/unread-count").json()["count"] == count


def test_it03_client_isolation(u):
    for who, n in [("cl1", 8), ("cl2", 5), ("cl3", 7)]:
        r = getattr(u, who).get("/tickets", params={"page_size": 100}).json()
        assert r["total"] == n
    other = ticket_by_number(u.dsp, "SR-2026-0003")  # организация C2
    for path in ["", "/events", "/attachments", "/comments", "/acts", "/parts", "/assignments"]:
        assert u.cl1.get(f"/tickets/{other['id']}{path}").status_code == 404, path
    assert u.cl1.get("/tickets", params={"organization_id": other["organization"]["id"]}).json()["total"] == 0
    eq = equipment_id(u.dsp, "DA-TR-0001")
    assert u.cl1.get(f"/equipment/{eq}").status_code == 404
    assert u.cl1.get("/equipment/by-qr/DEMOEQUIP005").status_code == 404
    assert u.cl1.get("/equipment", params={"q": "DA-TR-0001"}).json()["total"] == 0
    assert u.cl1.get("/search", params={"q": "SR-2026-0003"}).json()["tickets"] == []
    assert u.cl1.get(f"/organizations/{other['organization']['id']}").status_code == 404
    assert u.cl1.get("/users").status_code == 403
    # internal не виден клиенту
    c = ticket_by_number(u.dsp, "SR-2026-0012")
    assert u.cl3.get(f"/tickets/{c['id']}/comments").json()["total"] == 0
    assert u.dsp.get(f"/tickets/{c['id']}/comments").json()["total"] == 1
    evs = u.cl3.get(f"/tickets/{c['id']}/events", params={"page_size": 100}).json()["items"]
    assert all(e["visibility"] == "public" for e in evs)


def test_it04_engineer_access(u):
    e1 = {t["number"] for t in u.eng1.get("/tickets", params={"page_size": 100}).json()["items"]}
    e2 = {t["number"] for t in u.eng2.get("/tickets", params={"page_size": 100}).json()["items"]}
    assert e1 == {f"SR-2026-{n:04d}" for n in (1, 3, 5, 7, 9, 12, 14)}
    assert e2 == {f"SR-2026-{n:04d}" for n in (2, 4, 6, 8, 10, 11, 13)}
    t13 = ticket_by_number(u.dsp, "SR-2026-0013")
    assert u.eng1.get(f"/tickets/{t13['id']}").status_code == 404  # переназначена
    assert u.eng2.get(f"/tickets/{t13['id']}").status_code == 200
    t20 = ticket_by_number(u.dsp, "SR-2026-0020")
    assert u.eng2.get(f"/tickets/{t20['id']}").status_code == 404
    assert u.eng1.get("/equipment/by-qr/DEMOEQUIP003").status_code == 404  # РУ-6 кВ без заявок у ENG1
    assert u.eng1.get("/equipment/by-qr/DEMOEQUIP009").status_code == 200
    assert u.eng1.get("/users").status_code == 403
    assert u.eng1.get("/analytics/summary").status_code == 200


def test_it12_foreign_files_and_pdf(u):
    t3 = ticket_by_number(u.dsp, "SR-2026-0003")
    acts = u.cl2.get(f"/tickets/{t3['id']}/acts").json()
    atts = u.cl2.get(f"/tickets/{t3['id']}/attachments").json()
    assert acts and atts
    assert u.cl2.get(f"/acts/{acts[0]['id']}/pdf").status_code == 200
    r = u.cl2.get(f"/acts/{acts[0]['id']}/pdf")
    assert r.content.startswith(b"%PDF") and r.headers["x-content-type-options"] == "nosniff"
    for path in [f"/acts/{acts[0]['id']}/pdf", f"/acts/{acts[0]['id']}", f"/attachments/{atts[0]['id']}/download", f"/attachments/{atts[0]['id']}/thumbnail"]:
        assert u.cl1.get(path).status_code == 404, path
        assert u.eng2.get(path).status_code == 404, path  # заявку 0003 вёл ENG1
    assert u.eng1.get(f"/acts/{acts[0]['id']}/pdf").status_code == 200
    audit = u.adm.get("/audit-log", params={"action": "access_denied"}).json()
    assert audit["total"] >= 3


def test_it15_passport_history_qr(u):
    eq = equipment_id(u.cl1, "DM-TR-0001")
    d = u.cl1.get(f"/equipment/{eq}").json()
    assert d["qr_code"] == "DEMOEQUIP001" and d["repeat_failures_90d"] >= 1
    h = u.cl1.get(f"/equipment/{eq}/history").json()
    assert [x["ticket"]["number"] for x in h["items"]] == ["SR-2026-0011", "SR-2026-0001"]
    assert h["items"][1]["current_act_id"] and "течь" in h["items"][1]["diagnosis"].lower()
    r = u.cl1.get(f"/equipment/{eq}/qr", params={"format": "png"})
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    assert u.cl1.get("/equipment/by-qr/DEMOEQUIP001").json()["redirect"] == f"/equipment/{eq}"


def test_it36_list_params(u):
    assert u.dsp.get("/tickets", params={"page_size": 101}).status_code == 422
    assert u.dsp.get("/tickets", params={"sort": "description"}).status_code == 422
    assert u.dsp.get("/tickets", params={"bogus": "1"}).status_code == 422
    r = u.dsp.get("/tickets", params={"status": ["new", "accepted"], "sort": "-created_at", "page_size": 2}).json()
    assert r["total"] == 3 and len(r["items"]) == 2 and r["total_pages"] == 2
    assert u.dsp.get("/tickets", params={"overdue": "true"}).json()["total"] == 2
    assert u.dsp.get("/health/ready").status_code == 200


def test_error_format_and_auth(u, app):
    from tests.conftest import Api
    anon = Api(app, None)
    r = anon.get("/tickets")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED" and r.json()["error"]["request_id"]
    assert anon.get("/health/live").status_code == 200
    r = u.dsp.post("/tickets", json={"title": "a"})
    assert r.status_code == 422 and r.json()["error"]["details"]["fields"]


def test_board_card_fields(u):
    t = ticket_by_number(u.dsp, "SR-2026-0001")
    assert t["checklist"] == {"done": 5, "total": 5} and t["parts_count"] == 2 and t["comments_count"] == 1
    assert t["equipment"]["model"] == "ТМ-1000/10"
    t8 = ticket_by_number(u.dsp, "SR-2026-0008")
    assert t8["checklist"]["done"] == 0 and t8["checklist"]["total"] == 7 and t8["comments_count"] == 1
    # клиенту внутренний комментарий и запчасти не раскрываются
    c1 = ticket_by_number(u.cl1, "SR-2026-0001")
    assert c1["comments_count"] == 0 and c1["parts_count"] == 0
    assert ticket_by_number(u.dsp, "SR-2026-0016")["checklist"] is None


def test_server_time_header_for_sla_countdown(u):
    r = u.dsp.get("/health/live")
    assert r.headers["x-server-time"].startswith("2026-03-16T10:00:00")
