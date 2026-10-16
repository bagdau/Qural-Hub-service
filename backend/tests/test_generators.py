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
    ("РУ-6 кВ, 12 ячеек", "switchgear", "РУ-6 кВ", "Распределительное устройство РУ-6 кВ, 12 ячеек"),
])
def test_label_names(name, kind, short, full):
    from app.generators import documents
    assert documents.names(name, kind) == (short, full)


def test_equipment_card_has_short_and_full_name(u):
    d = u.dsp.get(f"/equipment/{equipment_id(u.dsp, 'DL-KTP-0002')}").json()
    assert d["short_name"] == "КТП-160" and d["full_name"].endswith("КТП-160") and d["full_name"] != d["short_name"]


def test_site_coordinates_in_api_and_validation(u):
    eq = u.dsp.get(f"/equipment/{equipment_id(u.dsp, 'DM-TR-0001')}").json()
    assert 43 < eq["site"]["latitude"] < 44 and 76 < eq["site"]["longitude"] < 78
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
