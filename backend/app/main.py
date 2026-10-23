import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import APIRouter, FastAPI, Request
from sqlalchemy import text

from . import clock, errors, realtime, storage
from .config import get_settings
from .db import SessionLocal, engine
from .publicurl import remember_request
from .routers import auth, equipment, events, execution, files, misc, orgs, tickets, users

log = logging.getLogger("app")


class JsonFormatter(logging.Formatter):
    def format(self, r: logging.LogRecord) -> str:
        d = {"ts": datetime.utcnow().isoformat() + "Z", "level": r.levelname, "logger": r.name, "msg": r.getMessage()}
        for k in ("request_id", "method", "path", "status", "duration_ms", "user_id"):
            if hasattr(r, k):
                d[k] = getattr(r, k)
        if r.exc_info:
            d["exc"] = self.formatException(r.exc_info)
        return json.dumps(d, ensure_ascii=False)


def setup_logging():
    s = get_settings()
    h = logging.StreamHandler()
    h.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [h]
    root.setLevel(s.log_level)
    logging.getLogger("uvicorn.access").disabled = True


def wait_for_db(timeout: int = 60):
    start, delay = time.time(), 1.0
    while True:
        try:
            with engine().connect() as c:
                c.execute(text("SELECT 1"))
            return
        except Exception as exc:  # noqa: BLE001
            if time.time() - start > timeout:
                raise
            log.warning("БД недоступна, повтор через %.0f с: %s", delay, exc.__class__.__name__)
            time.sleep(delay)
            delay = min(delay * 2, 8)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    wait_for_db()
    storage.ensure()
    realtime.hub.start()
    log.info("Qural Hub %s запущен (env=%s, clock=%s)", get_settings().app_version,
             get_settings().app_env, get_settings().app_clock_mode)
    yield


def create_app() -> FastAPI:
    s = get_settings()
    docs = s.enable_docs or s.app_env in ("dev", "test", "demo")
    app = FastAPI(title="Qural Hub API", version=s.app_version, lifespan=lifespan,
                  openapi_url="/api/v1/openapi.json" if docs else None,
                  docs_url="/api/v1/docs" if docs else None, redoc_url=None)
    errors.install(app)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id")
        try:
            rid = str(uuid.UUID(rid)) if rid else str(uuid.uuid4())
        except ValueError:
            rid = str(uuid.uuid4())
        request.state.request_id = uuid.UUID(rid)
        remember_request(request.headers.get("x-forwarded-host") or request.headers.get("host"), request.headers.get("x-forwarded-proto") or request.url.scheme)
        t0 = time.time()
        resp = await call_next(request)
        resp.headers["X-Request-Id"] = rid
        resp.headers["X-Server-Time"] = clock.now().isoformat()
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        if request.url.path.startswith("/api/") and request.url.path != "/api/v1/health/live":
            log.info("%s %s -> %s", request.method, request.url.path, resp.status_code,
                     extra={"request_id": rid, "method": request.method, "path": request.url.path,
                            "status": resp.status_code, "duration_ms": round((time.time() - t0) * 1000)})
        return resp

    api = APIRouter(prefix="/api/v1")
    for r in (misc.router, auth.router, users.router, orgs.router, equipment.router, tickets.router,
              execution.router, files.router, events.router):
        api.include_router(r)

    if s.app_env == "test":
        @api.post("/_test/clock", tags=["test"])
        def set_clock(body: dict):
            v = body.get("now")
            clock.set_override(clock.parse_iso(v) if v else None)
            return {"now": clock.now()}

    app.include_router(api)
    return app


app = create_app()
