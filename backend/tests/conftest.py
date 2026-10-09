import io
import os
import shutil
import tempfile
import uuid

os.environ.update(
    APP_ENV="test", APP_CLOCK_MODE="fixed", APP_FIXED_NOW="2026-03-16T10:00:00Z", ALLOW_DEMO_SEED="true",
    DEMO_USER_PASSWORD="Demo-Password-123!", COOKIE_SECURE="false", SECRET_KEY="test-secret-key-for-tests",
)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

PW = os.environ["DEMO_USER_PASSWORD"]
API = "/api/v1"


def _admin_conn():
    return psycopg.connect(host=os.environ.get("POSTGRES_HOST", "db-test"), user=os.environ["POSTGRES_USER"],
                           password=os.environ["POSTGRES_PASSWORD"], dbname="postgres", autocommit=True)


def _use(db_name: str, files_dir: str):
    from app import db as dbm
    from app.config import get_settings
    if dbm._engine is not None:
        dbm._engine.dispose()
    dbm._engine = dbm._Session = None
    os.environ["POSTGRES_DB"] = db_name
    os.environ["FILES_DIR"] = files_dir
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def template_db():
    name = "ash_tpl_" + uuid.uuid4().hex[:8]
    files = tempfile.mkdtemp(prefix="ash-tpl-files-")
    with _admin_conn() as c:
        c.execute(f'CREATE DATABASE "{name}"')
    _use(name, files)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    from app.db import SessionLocal
    from seed.loader import SEED_VERSION, load
    from app.cli import set_meta
    db = SessionLocal()
    load(db, PW)
    set_meta(db, "demo_seed_version", SEED_VERSION)
    db.commit()
    db.close()
    from app import db as dbm
    dbm._engine.dispose()
    yield name, files
    with _admin_conn() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
    shutil.rmtree(files, ignore_errors=True)


@pytest.fixture(scope="module")
def env(template_db):
    """Отдельная копия демо-БД и файлов на каждый тестовый модуль."""
    tpl, tpl_files = template_db
    name = "ash_t_" + uuid.uuid4().hex[:8]
    files = tempfile.mkdtemp(prefix="ash-files-")
    shutil.rmtree(files)
    shutil.copytree(tpl_files, files)
    with _admin_conn() as c:
        c.execute(f'CREATE DATABASE "{name}" TEMPLATE "{tpl}"')
    _use(name, files)
    from app import clock
    clock.set_override(None)
    yield name
    from app import db as dbm
    if dbm._engine is not None:
        dbm._engine.dispose()
    with _admin_conn() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
    shutil.rmtree(files, ignore_errors=True)


@pytest.fixture(scope="module")
def app(env):
    from app.main import app as a
    return a


class Api:
    def __init__(self, app, email):
        self.c = TestClient(app, raise_server_exceptions=False)
        self.email = email
        if email:
            r = self.c.post(f"{API}/auth/login", json={"email": email, "password": PW})
            assert r.status_code == 200, r.text
            self.c.headers["X-CSRF-Token"] = r.json()["csrf_token"]

    def get(self, path, **kw):
        return self.c.get(API + path, **kw)

    def post(self, path, json=None, idem=True, **kw):
        h = dict(kw.pop("headers", {}))
        if idem:
            h.setdefault("Idempotency-Key", str(uuid.uuid4()))
        return self.c.post(API + path, json=json, headers=h, **kw)

    def put(self, path, json=None):
        return self.c.put(API + path, json=json)

    def patch(self, path, json=None):
        return self.c.patch(API + path, json=json)

    def delete(self, path):
        return self.c.delete(API + path)


EMAILS = dict(adm="admin", dsp="dispatcher", mgr="manager", eng1="engineer1", eng2="engineer2",
              cl1="client.metal", cl2="client.agro", cl3="client.logistics")


@pytest.fixture(scope="module")
def u(app):
    cache = {}

    class Users:
        def __getattr__(self, k):
            if k not in cache:
                cache[k] = Api(app, f"{EMAILS[k]}@demo.alageum.test")
            return cache[k]
    return Users()


def png_bytes(w=320, h=240, color=(30, 80, 140)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, format="PNG")
    return b.getvalue()


def ticket_by_number(api: Api, number: str) -> dict:
    r = api.get("/tickets", params={"q": number})
    assert r.status_code == 200, r.text
    items = [t for t in r.json()["items"] if t["number"] == number]
    assert items, f"{number} не найдена"
    return items[0]


def equipment_id(api: Api, inv: str) -> str:
    r = api.get("/equipment", params={"q": inv})
    return r.json()["items"][0]["id"]
