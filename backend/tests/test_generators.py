"""Генераторы QR и документов (отдельные модули)."""
import io

import pytest
from PIL import Image

from tests.conftest import equipment_id


def test_qr_png_svg_options(u):
    eq = equipment_id(u.dsp, "DM-TR-0001")
    r = u.dsp.get(f"/equipment/{eq}/qr", params={"format": "png", "size": 12, "ec": "h", "border": 6})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    im = Image.open(io.BytesIO(r.content))
    assert im.width == im.height and im.width >= 12 * 25  # крупные модули
    px = im.convert("L").getextrema()
    assert px == (0, 255)  # максимальный контраст: чёрный на белом
    svg = u.dsp.get(f"/equipment/{eq}/qr", params={"format": "svg"})
    assert svg.status_code == 200 and b"<svg" in svg.content
    dl = u.dsp.get(f"/equipment/{eq}/qr", params={"format": "png", "download": 1})
    assert "attachment" in dl.headers["content-disposition"]
    assert u.dsp.get(f"/equipment/{eq}/qr", params={"ec": "z"}).status_code == 422
    assert u.dsp.get(f"/equipment/{eq}/qr", params={"format": "gif"}).status_code == 422
    assert u.dsp.get(f"/equipment/{eq}/qr", params={"border": 2}).status_code == 422  # тихая зона не меньше 4


@pytest.mark.parametrize("layout", ["sheet8", "label100x70", "sticker50x30"])
def test_label_layouts(u, layout):
    ids = ",".join(equipment_id(u.dsp, inv) for inv in ("DM-TR-0001", "DM-KTP-0002", "DA-TR-0001"))
    r = u.dsp.get("/equipment/qr-labels.pdf", params={"ids": ids, "layout": layout})
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
    assert u.dsp.get("/equipment/qr-labels.pdf", params={"ids": ids, "layout": "nope"}).status_code == 422
    layouts = u.cl1.get("/equipment/qr-layouts").json()
    assert {l["id"] for l in layouts} == {"sheet8", "label100x70", "sticker50x30"}


def test_label_and_passport_access(u):
    own = equipment_id(u.cl1, "DM-TR-0001")
    foreign = equipment_id(u.dsp, "DA-TR-0001")
    assert u.cl1.get(f"/equipment/{own}/qr-label.pdf").content.startswith(b"%PDF")
    p = u.cl1.get(f"/equipment/{own}/passport.pdf", params={"download": 1})
    assert p.status_code == 200 and p.content.startswith(b"%PDF") and "attachment" in p.headers["content-disposition"]
    no_eng = equipment_id(u.dsp, "DM-RU-0003")  # у ENG1 нет видимых заявок по этому оборудованию
    for path in (f"/equipment/{foreign}/qr-label.pdf", f"/equipment/{foreign}/passport.pdf", f"/equipment/{foreign}/qr"):
        assert u.cl1.get(path).status_code == 404
    for path in (f"/equipment/{no_eng}/qr-label.pdf", f"/equipment/{no_eng}/passport.pdf", f"/equipment/{no_eng}/qr"):
        assert u.eng1.get(path).status_code == 404
    assert u.cl1.get("/equipment/qr-labels.pdf", params={"ids": own}).status_code == 403  # пакетная печать — только диспетчер и администратор
    assert u.eng1.get(f"/equipment/{equipment_id(u.dsp, 'DL-KTP-0002')}/passport.pdf").status_code == 200  # свой объект инженера


@pytest.mark.parametrize("name,kind,short,full", [
    ("КТП-160", "substation", "КТП-160", "Трансформаторная подстанция КТП-160"),
    ("Трансформатор ТМ-1000/10", "transformer", "ТМ-1000/10", "Силовой трансформатор ТМ-1000/10"),
    ("РУ-6 кВ, 12 ячеек", "switchgear", "РУ-6 кВ", "Распределительная подстанция РУ-6 кВ, 12 ячеек"),
    ("РУ-0,4 кВ щит ввода", "switchgear", "РУ-0,4 кВ щит ввода", "Распределительная подстанция РУ-0,4 кВ щит ввода"),
])
def test_label_names(name, kind, short, full):
    from app.generators import documents
    assert documents.names(name, kind) == (short, full)


def test_equipment_card_has_short_and_full_name(u):
    d = u.dsp.get(f"/equipment/{equipment_id(u.dsp, 'DL-KTP-0002')}").json()
    assert d["short_name"] == "КТП-160" and d["full_name"].endswith("КТП-160") and d["full_name"] != d["short_name"]


def test_site_coordinates_in_api_and_validation(u):
    eq = u.dsp.get(f"/equipment/{equipment_id(u.dsp, 'DM-TR-0001')}").json()
    assert 42 < eq["site"]["latitude"] < 43 and 69 < eq["site"]["longitude"] < 70
    sites = u.adm.get("/sites", params={"page_size": 100}).json()["items"]
    assert all(s["latitude"] is not None for s in sites)
    s = sites[0]
    ok = u.adm.patch(f"/sites/{s['id']}", json={"version": s["version"], "latitude": 51.1694, "longitude": 71.4491})
    assert ok.status_code == 200 and ok.json()["latitude"] == 51.1694
    only_one = u.adm.patch(f"/sites/{s['id']}", json={"version": ok.json()["version"], "latitude": 10})
    assert only_one.status_code == 422
    out_of_range = u.adm.patch(f"/sites/{s['id']}", json={"version": ok.json()["version"], "latitude": 123, "longitude": 10})
    assert out_of_range.status_code == 422
    cleared = u.adm.patch(f"/sites/{s['id']}", json={"version": ok.json()["version"], "latitude": None, "longitude": None})
    assert cleared.status_code == 200 and cleared.json()["latitude"] is None
    back = u.adm.patch(f"/sites/{s['id']}", json={"version": cleared.json()["version"], "latitude": s["latitude"], "longitude": s["longitude"]})
    assert back.status_code == 200      # тест не оставляет изменённых координат другим тестам
    assert u.dsp.patch(f"/sites/{s['id']}", json={"version": 1, "latitude": 1, "longitude": 1}).status_code == 403


def test_public_base_auto_follows_the_opened_address(monkeypatch):
    from app import publicurl

    class Cfg:
        app_public_url = "auto"
    monkeypatch.setattr(publicurl, "get_settings", lambda: Cfg)
    publicurl.remember_request("10.205.3.215:8443", "https")
    assert publicurl.public_base() == "https://10.205.3.215:8443"
    publicurl.remember_request("bad host<script>", "http")   # недопустимые символы игнорируются
    assert publicurl.public_base() == "https://10.205.3.215:8443"

    class Fixed:
        app_public_url = "https://service.example.kz/"
    monkeypatch.setattr(publicurl, "get_settings", lambda: Fixed)
    assert publicurl.public_base() == "https://service.example.kz"


def test_equipment_coordinates_editor_and_map_signals(u):
    eid = equipment_id(u.dsp, "DM-TR-0001")
    d = u.dsp.get(f"/equipment/{eid}").json()
    assert d["geo"]["source"] == "equipment" and 42 < d["latitude"] < 43
    ok = u.dsp.patch(f"/equipment/{eid}", json={"version": d["version"], "latitude": 43.2611, "longitude": 76.9301})
    assert ok.status_code == 200 and ok.json()["latitude"] == 43.2611
    assert u.dsp.patch(f"/equipment/{eid}", json={"version": ok.json()["version"], "latitude": 43.2}).status_code == 422
    assert u.dsp.patch(f"/equipment/{eid}", json={"version": ok.json()["version"], "latitude": 95, "longitude": 10}).status_code == 422
    cleared = u.dsp.patch(f"/equipment/{eid}", json={"version": ok.json()["version"], "latitude": None, "longitude": None}).json()
    assert cleared["latitude"] is None and cleared["geo"]["source"] == "site"      # возврат к координатам площадки
    assert u.eng1.patch(f"/equipment/{eid}", json={"version": 1, "latitude": 1, "longitude": 1}).status_code == 403

    m = u.dsp.get("/map/objects").json()
    assert m["total"] == 10 and m["without_geo"] == 0
    by_name = {i["name"]: i for i in m["items"]}
    assert by_name["КТП-160"]["alert"] == "accident"                  # критическая заявка SR-2026-0017
    assert any(t["priority"] == "critical" for t in by_name["КТП-160"]["tickets"])
    assert {i["alert"] for i in m["items"]} <= {"accident", "call", "plan", "ok"}
    assert m["counts"]["accident"] >= 1 and sum(m["counts"].values()) == m["total"]
    assert by_name["КТП-160"]["short_name"] == "КТП-160" and by_name["КТП-160"]["type"] == "substation"
    # клиент видит только своё оборудование и только свои заявки
    c = u.cl1.get("/map/objects").json()
    assert 0 < c["total"] < 10 and all(i["organization"]["name"] == c["items"][0]["organization"]["name"] for i in c["items"])


def test_write_is_visible_to_the_very_next_request(u):
    """Транзакция фиксируется до отправки ответа: следующий запрос сразу видит изменение (раньше commit шёл после ответа)."""
    import time
    eid = equipment_id(u.dsp, "DM-TR-0001")
    d = u.dsp.get(f"/equipment/{eid}").json()
    for i in range(15):
        lat = round(43.2 + i / 1000, 3)
        r = u.dsp.patch(f"/equipment/{eid}", json={"version": d["version"], "latitude": lat, "longitude": 76.9})
        assert r.status_code == 200
        d = u.dsp.get(f"/equipment/{eid}").json()      # немедленно, без пауз
        assert d["latitude"] == lat and d["version"] == r.json()["version"], f"запись не видна на шаге {i}"
    u.dsp.patch(f"/equipment/{eid}", json={"version": d["version"], "latitude": None, "longitude": None})
